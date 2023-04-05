#!/usr/bin/env node

import 'source-map-support/register';

import * as cdk from 'aws-cdk-lib';

import { InternalStockDomainStack } from '../lib/internal-stock-domain-stack';
import { config } from '../../config/config';

const app = new cdk.App();
new InternalStockDomainStack(app, 'InternalStockDomainStack', {
  env: {
    account: config.stock.accountId,
  },
  privateInternalStockAccountId: config.stock.accountId,
  publicExperienceLayerApiAccountId: config.externalApi.accountId,
  privateStockRestApiId: config.stock.restApiId,
  region: config.region,
  stage: config.stage,
});
