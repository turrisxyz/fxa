/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Firestore } from '@google-cloud/firestore';
import { Cacheable } from '@type-cacheable/core';
import {
  deleteAccountCustomer,
  getAccountCustomerByUid,
} from '../db/models/auth';
import { StatsD } from 'hot-shots';
import mapValues from 'lodash/mapValues';
import { Logger } from 'mozlog';
import { Stripe } from 'stripe';
import {
  CUSTOMER_RESOURCE,
  PAYMENT_METHOD_RESOURCE,
  VALID_RESOURCE_TYPES,
  SUBSCRIPTIONS_RESOURCE,
  INVOICES_RESOURCE,
  PRODUCT_RESOURCE,
  PLAN_RESOURCE,
  STRIPE_PRODUCTS_CACHE_KEY,
  STRIPE_PLANS_CACHE_KEY,
  FirestoreStripeError,
  STRIPE_PRICE_METADATA,
} from './StripeHelperSharedTypes';

import { StripeFirestore } from './StripeFirestore';
import {
  AbbrevPlan,
  AbbrevPlayPurchase,
  ConfiguredPlan,
} from '../subscriptions/types';
import { mapPlanConfigsByPriceId } from '../subscriptions/configuration/utils';
import { formatPlanConfigDto } from '../dto/auth/payments/plan-configuration';

import { PaymentConfigManagerShared } from './configuration/manager';
import { IPlaySubscriptionsStripeHelper } from './google-play/subscriptions';

/** Minimal configuration required for a shared stripe helper. */
export interface StripeHelperSharedConfig {
  subscriptions: {
    stripeApiKey: string;
  };
  authFirestore: {
    prefix: string;
  };
  subhub: {
    plansCacheTtlSeconds: number;
  };
}

/**
 * A base class containing StripHelper functionality that is shared across workspaces.
 */
export abstract class StripeHelperShared
  implements IPlaySubscriptionsStripeHelper
{
  /** Exposes underlying Stripe Instance */
  public readonly stripe: Stripe;

  /** Exposes underlying stripe firestore instance */
  protected readonly stripeFirestore: StripeFirestore;

  /** Plans and Product cache time to live */
  protected readonly plansAndProductsCacheTtlSeconds: number;

  /**
   * Create new SharedStripeHelper instance
   * @param config - A configuration object driving the stripe helper's configuration
   * @param firestore - A firestore instance
   * @param statsd - A statsd instance
   * @param log - A logger
   */
  constructor(
    protected readonly config: StripeHelperSharedConfig,
    protected readonly firestore: Firestore,
    protected readonly paymentConfigManager:
      | PaymentConfigManagerShared
      | undefined,
    protected readonly statsd: StatsD,
    protected readonly log: Logger
  ) {
    this.plansAndProductsCacheTtlSeconds = config.subhub.plansCacheTtlSeconds;

    this.stripe = new Stripe(config.subscriptions.stripeApiKey, {
      apiVersion: '2020-08-27',
      maxNetworkRetries: 3,
    });

    this.stripe.on('response', (response) => {
      this.statsd.timing('stripe_request', response.elapsed);
      // Note that we can't record the method/path as a tag
      // because ids are in the path which results in too great
      // of cardinality.
      this.statsd.increment('stripe_call', {
        error: (response.status >= 500).toString(),
      });
    });

    const firestore_prefix = `${config.authFirestore.prefix}stripe-`;
    const customerCollectionDbRef = this.firestore.collection(
      `${firestore_prefix}customers`
    );
    this.stripeFirestore = new StripeFirestore(
      this.firestore,
      customerCollectionDbRef,
      this.stripe,
      firestore_prefix
    );
  }

  /**
   * Given a plan indicates if the plan is in a valid state.
   * @param plan - Plan to validate
   * @returns - true if plan is valid
   */
  protected abstract validatePlan(plan: Stripe.Plan): Promise<boolean>;

  /**
   * Fetch a customer for the record from Stripe based on user id.
   * @param uid - Account id
   * @param expand - Attempts to fetch additional data about the customer, e.g. the default
   *               payment method
   */
  protected async _fetchCustomer(
    uid: string,
    expand?: ('subscriptions' | 'invoice_settings.default_payment_method')[]
  ): Promise<Stripe.Customer | void> {
    const { stripeCustomerId } = (await getAccountCustomerByUid(uid)) || {};
    if (!stripeCustomerId) {
      return;
    }

    // By default this has subscriptions expanded.
    let customer = await this.expandResource<Stripe.Customer>(
      stripeCustomerId,
      CUSTOMER_RESOURCE
    );

    if (customer.deleted) {
      await deleteAccountCustomer(uid);
      return;
    }

    // If the customer has subscriptions and no currency, we must have a stale
    // customer record. Let's update it.
    if (customer.subscriptions?.data.length && !customer.currency) {
      await this.stripeFirestore.fetchAndInsertCustomer(customer.id);
      // Retrieve the customer again.
      customer = await this.expandResource<Stripe.Customer>(
        stripeCustomerId,
        CUSTOMER_RESOURCE
      );
    }

    // Since the uid is just metadata and it isn't required when creating a new
    // customer _on Stripe dashboard_, we have an edge case where the customer
    // is created on Stripe and locally via the `customer.created` event, but
    // the uid metadata is still missing.  Throwing an error here causes a
    // profile fetch to fail, thus would block the user completely.
    //
    // Customers created through our regular flow will always have their uid in
    // the metadata.
    //
    // So, we'll only throw an error if the uid metadata is found and it does
    // not match.
    if (customer.metadata.userid && customer.metadata.userid !== uid) {
      // Duplicate email with non-match uid
      throw new Error(
        `Stripe Customer: ${customer.id} has mismatched uid in metadata.`
      );
    }

    // There's only 2 expansions used in our code-base:
    //  - subscriptions
    //  - invoice_settings.default_payment_method
    // Subscriptions is already expanded. Manually fetch the other if needed.
    if (expand?.includes('invoice_settings.default_payment_method')) {
      customer.invoice_settings.default_payment_method =
        await this.expandResource(
          customer.invoice_settings.default_payment_method,
          PAYMENT_METHOD_RESOURCE
        );
    }

    return customer;
  }

  /**
   * Accept a string ID or resource object, return a resource object after
   * retrieving (if necessary)
   *
   * @template T
   * @param {string | T} resource
   * @param {string} resourceType
   *
   * @returns {Promise<T>}
   */
  async expandResource<T>(
    resource: string | T,
    resourceType: typeof VALID_RESOURCE_TYPES[number]
  ): Promise<T> {
    if (typeof resource !== 'string') {
      return resource;
    }

    if (!VALID_RESOURCE_TYPES.includes(resourceType)) {
      const errorMsg = `stripeHelper.expandResource was provided an invalid resource type: ${resourceType}`;
      const error = new Error(errorMsg);
      this.log.error(`stripeHelper.expandResource.failed`, { error });
      throw error;
    }

    switch (resourceType) {
      case CUSTOMER_RESOURCE:
        const customer = await this.stripeFirestore.retrieveAndFetchCustomer(
          resource
        );
        const subscriptions =
          await this.stripeFirestore.retrieveCustomerSubscriptions(resource);
        (customer as any).subscriptions = {
          data: subscriptions as any,
          has_more: false,
        };
        // @ts-ignore
        return customer;
      case SUBSCRIPTIONS_RESOURCE:
        // @ts-ignore
        return this.stripeFirestore.retrieveAndFetchSubscription(resource);
      case INVOICES_RESOURCE:
        try {
          // TODO we could remove the getInvoiceWithDiscount method if we add logic
          // here to check if the discounts field is expanded but it would mean
          // adding another stipe call to get discounts even when unnecessary
          const invoice = await this.stripeFirestore.retrieveInvoice(resource);
          // @ts-ignore
          return invoice;
        } catch (err) {
          if (err.name === FirestoreStripeError.FIRESTORE_INVOICE_NOT_FOUND) {
            const invoice = await this.stripe.invoices.retrieve(resource, {
              expand: ['discounts'],
            });
            await this.stripeFirestore.retrieveAndFetchCustomer(
              invoice.customer as string
            );
            await this.stripeFirestore.insertInvoiceRecord(invoice);
            // @ts-ignore
            return invoice;
          }
          throw err;
        }
      case PAYMENT_METHOD_RESOURCE:
        try {
          const paymentMethod =
            await this.stripeFirestore.retrievePaymentMethod(resource);
          // @ts-ignore
          return paymentMethod;
        } catch (err) {
          if (
            err.name === FirestoreStripeError.FIRESTORE_PAYMENT_METHOD_NOT_FOUND
          ) {
            const paymentMethod = await this.stripe.paymentMethods.retrieve(
              resource
            );
            // Payment methods may not be attached to customers, in which case we
            // cannot store it in Firestore.
            if (paymentMethod.customer) {
              await this.stripeFirestore.retrieveAndFetchCustomer(
                paymentMethod.customer as string
              );
              await this.stripeFirestore.insertPaymentMethodRecord(
                paymentMethod
              );
            }
            // @ts-ignore
            return paymentMethod;
          }
          throw err;
        }
      case PRODUCT_RESOURCE:
        const products = await this.allProducts();
        // @ts-ignore
        return products.find((p) => p.id === resource);
      case PLAN_RESOURCE:
        const plans = await this.allPlans();
        // @ts-ignore
        return plans.find((p) => p.id === resource);
      default:
        // @ts-ignore
        return this.stripe[resourceType].retrieve(resource);
    }
  }

  /**
   * Fetches all products from stripe and returns them.
   *
   * Uses Redis caching if configured.
   */
  @Cacheable({
    cacheKey: STRIPE_PRODUCTS_CACHE_KEY,
    ttlSeconds: (_args, context) => context.plansAndProductsCacheTtlSeconds,
  })
  async allProducts(): Promise<Stripe.Product[]> {
    return this.fetchAllProducts();
  }

  /**
   * Fetch all product data and cache it if Redis is enabled.
   *
   * Use `allProducts` below to use the cached-enhanced version.
   */
  async fetchAllProducts(): Promise<Stripe.Product[]> {
    const products = [];
    for await (const product of this.stripe.products.list()) {
      products.push(product);
    }
    return products;
  }

  /**
   * Fetches all plans from stripe and returns them.
   *
   * Use `allPlans` below to use the cached-enhanced version.
   */
  async fetchAllPlans(): Promise<Stripe.Plan[]> {
    const plans = [];

    for await (const item of this.stripe.plans.list({
      active: true,
      expand: ['data.product'],
    })) {
      if (!item.product) {
        this.log.error(
          `fetchAllPlans - Plan "${item.id}" missing Product`,
          item
        );
        continue;
      }

      if (typeof item.product === 'string') {
        this.log.error(
          `fetchAllPlans - Plan "${item.id}" failed to load Product`,
          item
        );
        continue;
      }

      if (item.product.deleted === true) {
        this.log.error(
          `fetchAllPlans - Plan "${item.id}" associated with Deleted Product`,
          item
        );
        continue;
      }

      item.product.metadata = mapValues(item.product.metadata, (v) => v.trim());
      item.metadata = mapValues(item.metadata, (v) => v.trim());

      if (await this.validatePlan(item)) {
        plans.push(item);
      }
    }

    return plans;
  }

  /**
   * Fetches all plans from stripe and returns them.
   *
   * Uses Redis caching if configured.
   */
  @Cacheable({
    cacheKey: STRIPE_PLANS_CACHE_KEY,
    ttlSeconds: (_args, context) => context.plansAndProductsCacheTtlSeconds,
  })
  async allPlans(): Promise<Stripe.Plan[]> {
    return this.fetchAllPlans();
  }

  /**
   * Append any matching price ids and names to their corresponding AbbrevPlayPurchase.
   */
  async addPriceInfoToAbbrevPlayPurchases(
    purchases: AbbrevPlayPurchase[]
  ): Promise<
    (AbbrevPlayPurchase & {
      product_id: string;
      product_name: string;
      price_id: string;
    })[]
  > {
    const plans = await this.allAbbrevPlans();
    const appendedAbbrevPlayPurchases = [];
    for (const plan of plans) {
      const playSkus = this.priceToPlaySkus(plan);
      const matchingAbbrevPlayPurchases = purchases.filter((purchase) =>
        playSkus.includes(purchase.sku.toLowerCase())
      );
      for (const matchingAbbrevPlayPurchase of matchingAbbrevPlayPurchases) {
        appendedAbbrevPlayPurchases.push({
          ...matchingAbbrevPlayPurchase,
          product_id: plan.product_id,
          product_name: plan.product_name,
          price_id: plan.plan_id,
        });
      }
    }
    return appendedAbbrevPlayPurchases;
  }

  async allAbbrevPlans(): Promise<AbbrevPlan[]> {
    const plans = await this.allConfiguredPlans();
    return plans.map((p) => ({
      amount: p.amount,
      currency: p.currency,
      interval_count: p.interval_count,
      interval: p.interval,
      plan_id: p.id,
      plan_metadata: p.metadata,
      plan_name: p.nickname || '',
      product_id: (p.product as Stripe.Product).id,
      product_metadata: (p.product as Stripe.Product).metadata,
      product_name: (p.product as Stripe.Product).name,
      // TODO simple copy p.configuration below when remove the SUBSCRIPTIONS_FIRESTORE_CONFIGS_ENABLED feature flag
      // @ts-ignore: depending the SUBSCRIPTIONS_FIRESTORE_CONFIGS_ENABLED feature flag, p can be a Stripe.Plan, which does have a `configuration`
      configuration: p.configuration ?? null,
    }));
  }

  async allConfiguredPlans(): Promise<ConfiguredPlan[] | Stripe.Plan[]> {
    // for a transitional period we will include configs from both Firestore
    // docs and Stripe metadata when enabled by the feature flag, making it
    // possible for Payments to toggle the Firestore configs feature flag
    // without any changes or re-deploy necessary on the auth-server

    const allPlans = await this.allPlans();

    // TODO remove when removing the SUBSCRIPTIONS_FIRESTORE_CONFIGS_ENABLED feature flag
    if (!this.paymentConfigManager) {
      return allPlans;
    }

    const planConfigs = mapPlanConfigsByPriceId(
      await this.paymentConfigManager.allPlans()
    );

    return allPlans.map((p) => {
      (p as ConfiguredPlan).configuration = null;
      const planConfig = planConfigs[p.id];
      if (planConfig) {
        const mergedConfig =
          // TODO remove the ! when removing the SUBSCRIPTIONS_FIRESTORE_CONFIGS_ENABLED feature flag
          this.paymentConfigManager!.getMergedConfig(planConfig);
        (p as ConfiguredPlan).configuration = formatPlanConfigDto(mergedConfig);
      }
      return p as ConfiguredPlan;
    });
  }

  /**
   * Return a list of skus for a given price.
   */
  priceToPlaySkus(price: AbbrevPlan) {
    const priceSkus =
      price.plan_metadata?.[STRIPE_PRICE_METADATA.PLAY_SKU_IDS] || '';
    return priceSkus
      .trim()
      .split(',')
      .map((c) => c.trim().toLowerCase())
      .filter((c) => !!c);
  }
}
