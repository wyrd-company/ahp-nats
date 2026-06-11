import type { AhpTransport, JsonRpcMessage, TransportFrame } from '@microsoft/agent-host-protocol/client';
import type { NatsConnection, Subscription } from '@nats-io/transport-node';

import type { ServerTransport } from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface NatsMsgLike {
  readonly data: Uint8Array;
  readonly reply?: string;
  respond?(data?: Uint8Array): boolean;
}

export interface NatsRequestOptions {
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

export interface NatsConnectionLike {
  publish(subject: string, data?: Uint8Array, options?: { reply?: string }): void;
  request(subject: string, data?: Uint8Array, options?: NatsRequestOptions): Promise<NatsMsgLike>;
  subscribe(subject: string, options?: { queue?: string }): AsyncIterable<NatsMsgLike> & { unsubscribe(): void };
  flush?(): Promise<void>;
}

export type MsgLike = NatsMsgLike;

export interface AhpNatsTransportOptions {
  readonly connection: NatsConnection | NatsConnectionLike;
  readonly inboundSubject: string;
  readonly outboundSubject: string;
}

class NatsTextTransport {
  private readonly subscription: Subscription | (AsyncIterable<NatsMsgLike> & { unsubscribe(): void });
  private readonly readyPromise: Promise<void>;
  private readonly inbox: Array<string | null> = [];
  private waiter: ((message: string | null) => void) | undefined;
  private closed = false;

  constructor(private readonly options: AhpNatsTransportOptions) {
    this.subscription = options.connection.subscribe(options.inboundSubject);
    this.readyPromise = options.connection.flush?.() ?? Promise.resolve();
    void this.readLoop();
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  async sendText(text: string): Promise<void> {
    if (this.closed) {
      throw new Error('NATS transport closed');
    }
    await this.readyPromise;
    this.options.connection.publish(this.options.outboundSubject, encoder.encode(text));
  }

  async recvText(): Promise<string | null> {
    await this.readyPromise;
    const next = this.inbox.shift();
    if (next !== undefined) {
      return Promise.resolve(next);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      this.waiter = resolve;
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.subscription.unsubscribe();
    this.deliver(null);
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const message of this.subscription) {
        this.deliver(decoder.decode(message.data));
      }
    } finally {
      this.close();
    }
  }

  private deliver(message: string | null): void {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter(message);
      return;
    }
    this.inbox.push(message);
  }
}

export class NatsServerTransport implements ServerTransport {
  private readonly inner: NatsTextTransport;

  constructor(options: AhpNatsTransportOptions) {
    this.inner = new NatsTextTransport(options);
  }

  ready(): Promise<void> {
    return this.inner.ready();
  }

  send(message: JsonRpcMessage | string): Promise<void> {
    return this.inner.sendText(typeof message === 'string' ? message : JSON.stringify(message));
  }

  async recv(): Promise<TransportFrame | null> {
    const text = await this.inner.recvText();
    return text === null ? null : { kind: 'text', text };
  }

  close(): void {
    this.inner.close();
  }
}

export class NatsAhpClientTransport implements AhpTransport {
  private readonly inner: NatsTextTransport;

  constructor(options: AhpNatsTransportOptions) {
    this.inner = new NatsTextTransport(options);
  }

  ready(): Promise<void> {
    return this.inner.ready();
  }

  send(message: JsonRpcMessage | string): Promise<void> {
    return this.inner.sendText(typeof message === 'string' ? message : JSON.stringify(message));
  }

  async recv(): Promise<TransportFrame | null> {
    const text = await this.inner.recvText();
    return text === null ? null : { kind: 'text', text };
  }

  close(): void {
    this.inner.close();
  }
}

export function createNatsServerTransport(options: AhpNatsTransportOptions): ServerTransport {
  return new NatsServerTransport(options);
}

export function createNatsAhpClientTransport(options: AhpNatsTransportOptions): AhpTransport {
  return new NatsAhpClientTransport(options);
}
