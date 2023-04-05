#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { InternalOrdersDomainStack } from '../lib/internal-orders-domain-stack';
import { config } from '../../config/config';

const app = new cdk.App();
new InternalOrdersDomainStack(app, 'InternalOrdersDomainStack', {
  env: {
    account: config.orders.accountId,
  },
  privateInternalOrdersAccountId: config.orders.accountId,
  publicExperienceLayerApiAccountId: config.externalApi.accountId,
  privateOrdersRestApiId: config.orders.restApiId,
  stage: config.stage,
  region: config.region,
});
