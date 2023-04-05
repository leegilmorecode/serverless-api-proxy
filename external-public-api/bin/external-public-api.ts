#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { ExternalPublicApiStack } from '../lib/external-public-api-stack';
import { config } from '../../config/config';

const app = new cdk.App();
new ExternalPublicApiStack(app, 'ExternalPublicApiStack', {
  env: {
    account: config.externalApi.accountId,
  },
  privateInternalOrdersAccountId: config.orders.accountId,
  privateInternalStockAccountId: config.stock.accountId,
  privateStockRestApiId: config.stock.restApiId,
  privateOrdersRestApiId: config.orders.restApiId,
  region: config.region,
  stage: config.stage,
});
