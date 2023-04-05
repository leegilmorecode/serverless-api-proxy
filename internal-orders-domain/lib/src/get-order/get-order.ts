import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

import { RetrievedOrder } from '../types';
import { v4 as uuid } from 'uuid';

const client: DynamoDBClient = new DynamoDBClient({
  region: process.env.REGION,
});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'get-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!process.env.TABLE_NAME) {
      throw new Error('no table name supplied');
    }

    if (!event?.pathParameters?.id) {
      throw new Error('no order id supplied');
    }

    const { id } = event.pathParameters;

    const ordersTable = process.env.TABLE_NAME;

    const input: GetItemCommandInput = {
      TableName: ordersTable,
      Key: marshall({ id }),
    };

    const { Item } = await client.send(new GetItemCommand(input));

    if (!Item) throw new Error(`order id ${id} is not found`);

    const item = unmarshall(Item);

    const order: RetrievedOrder = {
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      storeId: item.storeId,
      created: item.created,
      type: item.type,
    };

    return {
      body: JSON.stringify(order),
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
