import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';

import { Construct } from 'constructs';

interface InternalOrdersStackProps extends StackProps {
  publicExperienceLayerApiAccountId: string;
  privateInternalOrdersAccountId: string;
  privateOrdersRestApiId: string;
  stage: string;
  region: string;
}

export class InternalOrdersDomainStack extends Stack {
  constructor(scope: Construct, id: string, props: InternalOrdersStackProps) {
    super(scope, id, props);

    const {
      publicExperienceLayerApiAccountId,
      privateInternalOrdersAccountId,
      privateOrdersRestApiId,
      stage,
      region,
    } = props;

    // create the vpc with one private subnet in two AZs
    const vpc: ec2.Vpc = new ec2.Vpc(this, 'InternalOrdersVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      natGateways: 0,
      maxAzs: 2,
      gatewayEndpoints: {
        dynamodb: {
          service: ec2.GatewayVpcEndpointAwsService.DYNAMODB, // create a gateway endpoint for dynamodb
          subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
        },
      },
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'private-subnet-1',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // create the dynamodb table
    const table: dynamodb.Table = new dynamodb.Table(this, 'DynamoDbTable', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      contributorInsightsEnabled: true,
      removalPolicy: RemovalPolicy.DESTROY,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
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
        environment: {
          TABLE_NAME: table.tableName,
          REGION: region,
        },
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
        environment: {
          TABLE_NAME: table.tableName,
          REGION: region,
        },
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      });

    // give the functions access to the dynamodb table
    table.grantReadData(getOrderHandler);
    table.grantWriteData(createOrdersHandler);

    // this api policy on the private internal domain api states that only requests from the external account
    // can be made (experience layer bff), and only posts on /orders
    const apiPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ['execute-api:Invoke'],
          principals: [
            new iam.AccountPrincipal(publicExperienceLayerApiAccountId), // this is the account which is calling it.
          ],
          resources: [
            // api arn + restapi + stage + method + path (exmaple below is authZ down to the given endpoint and method)
            `arn:aws:execute-api:${region}:${privateInternalOrdersAccountId}:${privateOrdersRestApiId}/${stage}/GET/orders/*`,
            `arn:aws:execute-api:${region}:${privateInternalOrdersAccountId}:${privateOrdersRestApiId}/${stage}/POST/orders/`,
          ],
        }),
      ],
    });

    // create the api for the private internal orders (domain api)
    const internalOrdersApi: apigw.RestApi = new apigw.RestApi(
      this,
      'InternalOrdersApi',
      {
        description: 'internal orders api',
        restApiName: 'internal-orders-api',
        deploy: true,
        policy: apiPolicy, // <-- the api resource policy is added here
        defaultMethodOptions: {
          authorizationType: apigw.AuthorizationType.IAM, // IAM-based authorization
        },
        endpointTypes: [apigw.EndpointType.PRIVATE], // this is a private domain layer api i.e. only accessible from this vpc
        // https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-private-apis.html
        deployOptions: {
          stageName: 'prod',
          dataTraceEnabled: true,
          loggingLevel: apigw.MethodLoggingLevel.INFO,
          tracingEnabled: true,
          metricsEnabled: true,
        },
      }
    );

    // create the orders resource for the internal domain api
    const orders: apigw.Resource = internalOrdersApi.root.addResource('orders');
    const order: apigw.Resource = orders.addResource('{id}');

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

    new CfnOutput(this, 'InternalOrdersApiArnToExecute', {
      value: internalOrdersApi.arnForExecuteApi(),
      description: 'The arn to execute for the internal orders api',
      exportName: 'internalOrdersApiArnToExecute',
    });

    new CfnOutput(this, 'InternalOrdersApiUrl', {
      value: internalOrdersApi.url,
      description: 'The url of the internal orders api',
      exportName: 'InternalOrdersApiUrl',
    });

    new CfnOutput(this, 'InternalOrdersRestApiId', {
      value: internalOrdersApi.restApiId,
      description: 'The rest api Id internal orders api',
      exportName: 'InternalOrdersRestApiId',
    });

    new CfnOutput(this, 'InternalOrdersAccountId', {
      value: this.account,
      exportName: 'InternalOrdersAccountId',
    });
  }
}
