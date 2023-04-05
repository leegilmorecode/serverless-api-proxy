import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from 'aws-lambda';

import { HttpRequest } from '@aws-sdk/protocol-http';
import { RetrievedOrder } from '../types';
import { URL } from 'url';
import fetch from 'node-fetch';
import { signRequest } from '../helpers/request-signer';
import { v4 as uuid } from 'uuid';

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = 'get-order.handler';
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!event?.pathParameters?.id) {
      throw new Error('no order id supplied');
    }

    const { id } = event.pathParameters;

    const url = new URL(`${process.env.ORDERS_API}`);

    const request = new HttpRequest({
      hostname: url.host, // https://12345.execute-api.eu-west-1.amazonaws.com/
      method: 'GET',
      headers: {
        host: url.host,
        'x-consumer-id': 'external-rest-api', // pass through headers for logging of consumers
      },
      path: `${url.pathname}${id}`, // prod/orders/{id}
    });

    // sign our request with SigV4 and send
    const signedRequest = await signRequest(request);
    const response = await fetch(
      `https://${url.host}${url.pathname}${id}`,
      signedRequest
    );
    const responseJson = (await response.json()) as RetrievedOrder;

    console.log(`response: ${JSON.stringify(responseJson)}`);

    return {
      statusCode: 200,
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
