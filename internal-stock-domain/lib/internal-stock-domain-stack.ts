import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';

import { Construct } from 'constructs';

interface InternalStockStackProps extends StackProps {
  publicExperienceLayerApiAccountId: string;
  privateInternalStockAccountId: string;
  privateStockRestApiId: string;
  stage: string;
  region: string;
}

export class InternalStockDomainStack extends Stack {
  constructor(scope: Construct, id: string, props: InternalStockStackProps) {
    super(scope, id, props);

    const {
      publicExperienceLayerApiAccountId,
      privateInternalStockAccountId,
      privateStockRestApiId,
      stage,
      region,
    } = props;

    // create the vpc with one private subnet in two AZs
    const vpc: ec2.Vpc = new ec2.Vpc(this, 'InternalStockVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),
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

    // create the create stock handler
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
        environment: {
          TABLE_NAME: table.tableName,
          REGION: region,
        },
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
        environment: {
          TABLE_NAME: table.tableName,
          REGION: region,
        },
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      });

    // give the functions access to the dynamodb table
    table.grantReadData(getStockItemHandler);
    table.grantWriteData(createStockHandler);

    // this api policy on the private internal domain api states that only requests from the external account
    // can be made (experience layer bff), and only posts on /stock
    const apiPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ['execute-api:Invoke'],
          principals: [
            new iam.AccountPrincipal(publicExperienceLayerApiAccountId), // this is the account which is calling it.
          ],
          resources: [
            // api arn + restapi + stage + method + path (exmaple below is authZ down to the given endpoint and method)
            `arn:aws:execute-api:${region}:${privateInternalStockAccountId}:${privateStockRestApiId}/${stage}/GET/stock/*`,
            `arn:aws:execute-api:${region}:${privateInternalStockAccountId}:${privateStockRestApiId}/${stage}/POST/stock/`,
          ],
        }),
      ],
    });

    // create the api for the private internal stock (domain api)
    const internalStockApi: apigw.RestApi = new apigw.RestApi(
      this,
      'InternalStockApi',
      {
        description: 'internal stock api',
        restApiName: 'internal-stock-api',
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

    // create the stock resource for the internal domain api
    const stock: apigw.Resource = internalStockApi.root.addResource('stock');
    const stockItem: apigw.Resource = stock.addResource('{id}');

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

    new CfnOutput(this, 'InternalStockApiArnToExecute', {
      value: internalStockApi.arnForExecuteApi(),
      description: 'The arn to execute for the internal stock api',
      exportName: 'internalStockApiArnToExecute',
    });

    new CfnOutput(this, 'InternalStockApiUrl', {
      value: internalStockApi.url,
      description: 'The url of the internal stock api',
      exportName: 'InternalStockApiUrl',
    });

    new CfnOutput(this, 'InternalStockRestApiId', {
      value: internalStockApi.restApiId,
      description: 'The rest api Id internal stock api',
      exportName: 'InternalStockRestApiId',
    });

    new CfnOutput(this, 'InternalStockAccountId', {
      value: this.account,
      exportName: 'InternalStockAccountId',
    });
  }
}
