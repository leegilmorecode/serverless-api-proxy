import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';

import { StockItem } from '../types';
import { marshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuid } from 'uuid';

const client: DynamoDBClient = new DynamoDBClient({
  region: process.env.REGION,
});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-stock.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!process.env.TABLE_NAME) {
      throw new Error('no table name supplied');
    }

    if (!event.body) {
      throw new Error('no stock item supplied');
    }

    // we take the body (payload) from the event coming through from api gateway
    const item = JSON.parse(event.body);

    const stockTable = process.env.TABLE_NAME;

    // we wont validate the input with this being a basic example only
    const createdDateTime = new Date().toISOString();

    const stockItem: StockItem = {
      ...item,
      id: uuid(),
      type: 'Stock',
      created: createdDateTime,
    };

    console.log(`${prefix} - stock item: ${JSON.stringify(stockItem)}`);

    console.log(`${prefix} - create stock item: ${JSON.stringify(stockItem)}`);

    const input: PutItemCommandInput = {
      TableName: stockTable,
      Item: marshall(stockItem),
    };

    await client.send(new PutItemCommand(input));

    // api gateway needs us to return this body (stringified) and the status code

    return {
      body: JSON.stringify(stockItem),
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
