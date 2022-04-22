/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Stripe } from 'stripe';

export const CUSTOMER_RESOURCE = 'customers';
export const PAYMENT_METHOD_RESOURCE = 'paymentMethods';
export const CHARGES_RESOURCE = 'charges';
export const COUPON_RESOURCE = 'coupons';
export const CREDIT_NOTE_RESOURCE = 'creditNotes';
export const PRICE_RESOURCE = 'prices';
export const SOURCE_RESOURCE = 'sources';
export const TAX_RATE_RESOURCE = 'taxRates';
export const SUBSCRIPTIONS_RESOURCE = 'subscriptions';
export const INVOICES_RESOURCE = 'invoices';
export const PRODUCT_RESOURCE = 'products';
export const PLAN_RESOURCE = 'plans';
export const STRIPE_PRODUCTS_CACHE_KEY = 'listStripeProducts';
export const STRIPE_PLANS_CACHE_KEY = 'listStripePlans';

export const STRIPE_OBJECT_TYPE_TO_RESOURCE: Record<string, string> = {
  charge: CHARGES_RESOURCE,
  coupon: COUPON_RESOURCE,
  credit_note: CREDIT_NOTE_RESOURCE,
  customer: CUSTOMER_RESOURCE,
  invoice: INVOICES_RESOURCE,
  payment_method: PAYMENT_METHOD_RESOURCE,
  plan: PLAN_RESOURCE,
  price: PRICE_RESOURCE,
  product: PRODUCT_RESOURCE,
  source: SOURCE_RESOURCE,
  subscription: SUBSCRIPTIONS_RESOURCE,
  tax_rate: TAX_RATE_RESOURCE,
};

export const VALID_RESOURCE_TYPES = Object.values(
  STRIPE_OBJECT_TYPE_TO_RESOURCE
);

export const MOZILLA_TAX_ID = 'Tax ID';

export const STRIPE_TAX_RATES_CACHE_KEY = 'listStripeTaxRates';

export const SUBSCRIPTION_PROMOTION_CODE_METADATA_KEY = 'appliedPromotionCode';

export enum STRIPE_CUSTOMER_METADATA {
  PAYPAL_AGREEMENT = 'paypalAgreementId',
}

export enum STRIPE_PRICE_METADATA {
  PROMOTION_CODES = 'promotionCodes',
  PLAY_SKU_IDS = 'playSkuIds',
}

export enum STRIPE_PRODUCT_METADATA {
  PROMOTION_CODES = 'promotionCodes',
}

export enum STRIPE_INVOICE_METADATA {
  PAYPAL_TRANSACTION_ID = 'paypalTransactionId',
  PAYPAL_REFUND_TRANSACTION_ID = 'paypalRefundTransactionId',
  PAYPAL_REFUND_REASON = 'paypalRefundRefused',
  EMAIL_SENT = 'emailSent',
  RETRY_ATTEMPTS = 'paymentAttempts',
}

export const SUBSCRIPTION_UPDATE_TYPES = {
  UPGRADE: 'upgrade',
  DOWNGRADE: 'downgrade',
  REACTIVATION: 'reactivation',
  CANCELLATION: 'cancellation',
};

export type StripePlanWithProduct = Stripe.Plan & {
  metadata?: Stripe.Metadata;
} & { product: { metadata?: Stripe.Metadata } };

export type FormattedSubscriptionForEmail = {
  productId: string;
  productName: string;
  planId: string;
  planName: string | null;
  planEmailIconURL: string;
  planDownloadURL: string;
  productMetadata: Stripe.Metadata;
};

export type BillingAddressOptions = {
  city: string;
  country: string;
  line1: string;
  line2: string;
  postalCode: string;
  state: string;
};

// The countries we need region data for
export const COUNTRIES_LONG_NAME_TO_SHORT_NAME_MAP = {
  // The long name is used in the BigQuery metrics logs; the short name is used
  // in the Stripe customer billing address.  The long names are also used to
  // index into the country to states maps.
  'United States': 'US',
  Canada: 'CA',
} as { [key: string]: string };

export enum FirestoreStripeError {
  FIRESTORE_CUSTOMER_NOT_FOUND = 'FirestoreCustomerNotFound',
  FIRESTORE_SUBSCRIPTION_NOT_FOUND = 'FirestoreSubscriptionNotFound',
  FIRESTORE_INVOICE_NOT_FOUND = 'FirestoreInvoiceNotFound',
  FIRESTORE_PAYMENT_METHOD_NOT_FOUND = 'FirestorePaymentMethodNotFound',
  STRIPE_CUSTOMER_MISSING_UID = 'StripeCustomerMissingUid',
  STRIPE_CUSTOMER_DELETED = 'StripeCustomerDeleted',
}
