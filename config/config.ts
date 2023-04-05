export const config = {
  stage: 'prod',
  region: 'eu-west-1',
  // this could be pushed to a central aws accounts secrets manager for service discovery
  stock: {
    accountId: '11111111111',
    restApiId: '0e1w4rds11',
  },
  orders: {
    accountId: '22222222222',
    restApiId: '8vkm34k946',
  },
  externalApi: {
    accountId: '33333333333',
  },
};
