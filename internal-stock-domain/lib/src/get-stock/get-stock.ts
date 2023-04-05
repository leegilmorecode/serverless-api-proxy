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

import { RetrievedStockItem } from '../types';
import { v4 as uuid } from 'uuid';

const client: DynamoDBClient = new DynamoDBClient({
  region: process.env.REGION,
});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'get-stock-item.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!process.env.TABLE_NAME) {
      throw new Error('no table name supplied');
    }

    if (!event?.pathParameters?.id) {
      throw new Error('no stock item id supplied');
    }

    const { id } = event.pathParameters;

    const stockTable = process.env.TABLE_NAME;

    const input: GetItemCommandInput = {
      TableName: stockTable,
      Key: marshall({ id }),
    };

    const { Item } = await client.send(new GetItemCommand(input));

    if (!Item) throw new Error(`stock item id ${id} is not found`);

    const item = unmarshall(Item);

    const stockItem: RetrievedStockItem = {
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      created: item.created,
      type: item.type,
    };

    return {
      body: JSON.stringify(stockItem),
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
