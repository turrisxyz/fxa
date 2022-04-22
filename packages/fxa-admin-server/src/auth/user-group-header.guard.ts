/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { USER_GROUP_HEADER, guard, AdminPanelFeature } from 'fxa-shared/guards';
import { FEATURE_KEY } from './user-group-header.decorator';

@Injectable()
export class UserGroupGuard implements CanActivate {
  constructor(private reflector?: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Reflect on the end point to determine if it has been tagged with admin panel feature.
    // If it does, check to make sure the user's group has a permission level that permits access.
    const features =
      this.reflector?.getAllAndOverride<AdminPanelFeature[]>(FEATURE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    if (!features || features.length === 0) {
      return true;
    }

    // Requires different setup depending on context type. Currently
    // guards are only applied to GQL contexts.
    let userGroupHeader: string = '';
    if (context.getType().toString() === 'graphql') {
      userGroupHeader =
        GqlExecutionContext.create(context)
          ?.getContext()
          ?.req?.get(USER_GROUP_HEADER) || '';
    }

    const group = guard.getBestGroup(userGroupHeader);
    return features.some((x) => guard.allow(x, group));
  }
}
