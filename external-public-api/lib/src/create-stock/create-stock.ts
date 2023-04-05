import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { RetrievedStockItem, StockItem } from '../types';

import { HttpRequest } from '@aws-sdk/protocol-http';
import { URL } from 'url';
import fetch from 'node-fetch';
import { signRequest } from '../helpers/request-signer';
import { v4 as uuid } from 'uuid';

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'create-stock.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event.body) {
      throw new Error('no stock item supplied');
    }

    // we take the body (payload) from the event coming through from api gateway
    const item = JSON.parse(event.body);

    const stockItem: StockItem = {
      ...item,
    };

    const url = new URL(`${process.env.STOCK_API}`);

    const request = new HttpRequest({
      hostname: url.host, // https://12345.execute-api.eu-west-1.amazonaws.com/
      method: 'POST',
      body: JSON.stringify(stockItem),
      headers: {
        host: url.host,
        'x-consumer-id': 'external-rest-api', // pass through headers for logging of consumers
      },
      path: url.pathname, // prod/stock/
    });

    // sign our request with SigV4 and send
    const signedRequest = await signRequest(request);
    const response = await fetch(url.href, signedRequest);
    const responseJson = (await response.json()) as RetrievedStockItem;

    console.log(`response: ${JSON.stringify(responseJson)}`);

    return {
      statusCode: 201,
      body: JSON.stringify(responseJson),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      body: 'An error occurred',
    };
  }
};
