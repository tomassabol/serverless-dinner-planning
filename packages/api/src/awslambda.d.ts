import type { Writable } from 'node:stream';

/** Globals the Node.js Lambda runtime provides for response streaming. */
declare global {
  namespace awslambda {
    type ResponseStream = Writable;
    function streamifyResponse<TEvent>(
      handler: (event: TEvent, responseStream: ResponseStream, context: unknown) => Promise<void>,
    ): (event: TEvent, responseStream: ResponseStream, context: unknown) => Promise<void>;
    const HttpResponseStream: {
      from(stream: ResponseStream, metadata: { statusCode: number; headers?: Record<string, string> }): ResponseStream;
    };
  }
}

export {};
