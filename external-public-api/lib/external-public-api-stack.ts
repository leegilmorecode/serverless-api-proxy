import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

import { Stack, StackProps } from 'aws-cdk-lib';

import { Construct } from 'constructs';

interface ExternalStackProps extends StackProps {
  privateInternalStockAccountId: string;
  stage: string;
  region: string;
  privateInternalOrdersAccountId: string;
  privateOrdersRestApiId: string;
  privateStockRestApiId: string;
}

export class ExternalPublicApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ExternalStackProps) {
    super(scope, id, props);

    const {
      privateInternalStockAccountId,
      privateInternalOrdersAccountId,
      privateOrdersRestApiId,
      privateStockRestApiId,
      stage,
      region,
    } = props;

    // create the vpc with one private subnet in two AZs
    const vpc: ec2.Vpc = new ec2.Vpc(this, 'ExternalApiVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.2.0.0/16'),
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'private-subnet-1',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // add a security group for the vpc endpoint for all ssh traffic
    const sg: ec2.SecurityGroup = new ec2.SecurityGroup(this, 'ExternalVpcSg', {
      vpc,
      allowAllOutbound: true,
      securityGroupName: 'external-vpc-sg',
    });

    sg.addIngressRule(ec2.Peer.ipv4('10.2.0.0/16'), ec2.Port.tcp(443));

    // create the vpc endpoint to allow us to talk cross account to the private internal api
    // without the need for a nat gateway etc. this is powered by privatelink
    new ec2.InterfaceVpcEndpoint(this, 'ExternalApiVpcEndpoint', {
      vpc,
      service: {
        name: `com.amazonaws.eu-west-1.execute-api`,
        port: 443,
      },
      subnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }),
      privateDnsEnabled: true,
      securityGroups: [sg],
    });

    // create the create order handler
    const createOrdersHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'CreateOrdersHandler', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, './src/create-order/create-order.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
        },
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      });

    // create the get order handler
    const getOrderHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'GetOrderHandler', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, './src/get-order/get-order.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
        },
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      });

    // create the create stock item handler
    const createStockHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'CreateStockHandler', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, './src/create-stock/create-stock.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
        },
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      });

    // create the get stock item handler
    const getStockItemHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'GetStockItemHandler', {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: path.join(__dirname, './src/get-stock/get-stock.ts'),
        memorySize: 1024,
        handler: 'handler',
        bundling: {
          minify: true,
        },
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      });

    const externalPublicApi: apigw.RestApi = new apigw.RestApi(
      this,
      'ExperienceLayerApi',
      {
        description: 'Experience layer b2b api',
        restApiName: 'experience-layer-api',
        deploy: true,
        endpointTypes: [apigw.EndpointType.REGIONAL], // this is a regional experience layer api
        deployOptions: {
          stageName: 'prod',
          dataTraceEnabled: true,
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          tracingEnabled: true,
          metricsEnabled: true,
        },
      }
    );

    // create the relevant resources
    const stock: apigw.Resource = externalPublicApi.root.addResource('stock');
    const stockItem: apigw.Resource = stock.addResource('{id}');
    const orders: apigw.Resource = externalPublicApi.root.addResource('orders');
    const order: apigw.Resource = orders.addResource('{id}');

    // add the endpoint for creating a stock record (post) on /stock/
    stock.addMethod(
      'POST',
      new apigw.LambdaIntegration(createStockHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    // add the endpoint for getting a stock item (get) on /stock/{id}
    stockItem.addMethod(
      'GET',
      new apigw.LambdaIntegration(getStockItemHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    // add the endpoint for creating an order (post) on /orders/
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrdersHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    // add the endpoint for creating an order (get) on /orders/{id}
    order.addMethod(
      'GET',
      new apigw.LambdaIntegration(getOrderHandler, {
        proxy: true,
        allowTestInvoke: false,
      })
    );

    const internalOrdersApi = `https://${privateOrdersRestApiId}.execute-api.${region}.amazonaws.com/${stage}/orders/`;
    const internalStockApi = `https://${privateStockRestApiId}.execute-api.${region}.amazonaws.com/${stage}/stock/`;

    // this is the internal orders api passed through in env vars to the lambda
    createOrdersHandler.addEnvironment('ORDERS_API', internalOrdersApi);
    getOrderHandler.addEnvironment('ORDERS_API', internalOrdersApi);

    // this is the internal stock api passed through in env vars to the lambda
    createStockHandler.addEnvironment('STOCK_API', internalStockApi);
    getStockItemHandler.addEnvironment('STOCK_API', internalStockApi);

    // add a policy to the lambda role to allow it to call the execute api arn of the internal api
    createOrdersHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: [
          // api arn + restapi + stage + method + path
          `arn:aws:execute-api:${region}:${privateInternalOrdersAccountId}:${privateOrdersRestApiId}/${stage}/POST/orders/`,
        ],
      })
    );

    getOrderHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: [
          // api arn + restapi + stage + method + path
          `arn:aws:execute-api:${region}:${privateInternalOrdersAccountId}:${privateOrdersRestApiId}/${stage}/GET/orders/*`,
        ],
      })
    );

    // add a policy to the lambda role to allow it to call the execute api arn of the internal api
    createStockHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: [
          // api arn + restapi + stage + method + path
          `arn:aws:execute-api:${region}:${privateInternalStockAccountId}:${privateStockRestApiId}/${stage}/POST/stock/`,
        ],
      })
    );

    getStockItemHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:Invoke'],
        resources: [
          // api arn + restapi + stage + method + path
          `arn:aws:execute-api:${region}:${privateInternalStockAccountId}:${privateStockRestApiId}/${stage}/GET/stock/*`,
        ],
      })
    );
  }
}
