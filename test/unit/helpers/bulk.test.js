/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

'use strict';

const { createReadStream } = require('fs');
const { join } = require('path');
const split = require('split2');
const FakeTimers = require('@sinonjs/fake-timers');
const { test } = require('tap');
const { errors } = require('../../../');
const { Client, buildServer, connection } = require('../../utils');
let clientVersion = require('../../../package.json').version;
if (clientVersion.includes('-')) {
  clientVersion = clientVersion.slice(0, clientVersion.indexOf('-')) + 'p';
}

const dataset = [
  { user: 'jon', age: 23 },
  { user: 'arya', age: 18 },
  { user: 'tyrion', age: 39 },
];

test('bulk index', (t) => {
  t.test('datasource as array', (t) => {
    t.test('Should perform a bulk request', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, {
            'content-type': 'application/x-ndjson',
          });
          const [action, payload] = params.body.split('\n');
          t.same(JSON.parse(action), { index: { _index: 'test' } });
          t.same(JSON.parse(payload), dataset[count++]);
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.test('Should perform a bulk request (with concurrency)', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, { 'content-type': 'application/x-ndjson' });
          const [action, payload] = params.body.split('\n');
          t.same(JSON.parse(action), { index: { _index: 'test' } });
          t.same(JSON.parse(payload), dataset[count++]);
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
        enableMetaHeader: false,
      });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 3,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.test('Should perform a bulk request (high flush size)', async (t) => {
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, { 'content-type': 'application/x-ndjson' });
          t.equal(params.body.split('\n').filter(Boolean).length, 6);
          return { body: { errors: false, items: new Array(3).fill({}) } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 5000000,
        concurrency: 1,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.test('refreshOnCompletion', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          if (params.method === 'GET') {
            t.equal(params.path, '/_all/_refresh');
            return { body: { acknowledged: true } };
          } else {
            t.equal(params.path, '/_bulk');
            t.match(params.headers, { 'content-type': 'application/x-ndjson' });
            const [action, payload] = params.body.split('\n');
            t.same(JSON.parse(action), { index: { _index: 'test' } });
            t.same(JSON.parse(payload), dataset[count++]);
            return { body: { errors: false, items: [{}] } };
          }
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        refreshOnCompletion: true,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.test('refreshOnCompletion custom index', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          if (params.method === 'GET') {
            t.equal(params.path, '/test/_refresh');
            return { body: { acknowledged: true } };
          } else {
            t.equal(params.path, '/_bulk');
            t.match(params.headers, { 'content-type': 'application/x-ndjson' });
            const [action, payload] = params.body.split('\n');
            t.same(JSON.parse(action), { index: { _index: 'test' } });
            t.same(JSON.parse(payload), dataset[count++]);
            return { body: { errors: false, items: [{}] } };
          }
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        refreshOnCompletion: 'test',
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.test('Should perform a bulk request (custom action)', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, { 'content-type': 'application/x-ndjson' });
          const [action, payload] = params.body.split('\n');
          t.same(JSON.parse(action), { index: { _index: 'test', _id: count } });
          t.same(JSON.parse(payload), dataset[count++]);
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      let id = 0;
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        onDocument() {
          return {
            index: {
              _index: 'test',
              _id: id++,
            },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.test('Should perform a bulk request (retry)', async (t) => {
      async function handler(req, res) {
        t.equal(req.url, '/_bulk');
        t.match(req.headers, { 'content-type': 'application/x-ndjson' });

        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
          body += chunk;
        }
        const [, payload] = body.split('\n');

        res.setHeader('content-type', 'application/json');

        if (JSON.parse(payload).user === 'arya') {
          res.end(
            JSON.stringify({
              took: 0,
              errors: true,
              items: [
                {
                  index: {
                    status: 429,
                  },
                },
              ],
            })
          );
        } else {
          res.end(
            JSON.stringify({
              took: 0,
              errors: false,
              items: [{}],
            })
          );
        }
      }

      const [{ port }, server] = await buildServer(handler);
      const client = new Client({ node: `http://localhost:${port}` });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        wait: 10,
        retries: 1,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop(doc) {
          t.same(doc, {
            status: 429,
            error: null,
            operation: { index: { _index: 'test' } },
            document: { user: 'arya', age: 18 },
            retried: true,
          });
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 2,
        retry: 2,
        failed: 1,
        aborted: false,
      });
      server.stop();
    });

    t.test('Should perform a bulk request (retry a single document from batch)', async (t) => {
      function handler(req, res) {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            took: 0,
            errors: true,
            items: [
              { index: { status: 200 } },
              { index: { status: 429 } },
              { index: { status: 200 } },
            ],
          })
        );
      }

      const [{ port }, server] = await buildServer(handler);
      const client = new Client({ node: `http://localhost:${port}` });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        concurrency: 1,
        wait: 10,
        retries: 0,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop(doc) {
          t.same(doc, {
            status: 429,
            error: null,
            operation: { index: { _index: 'test' } },
            document: { user: 'arya', age: 18 },
            retried: false,
          });
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 2,
        retry: 0,
        failed: 1,
        aborted: false,
      });
      server.stop();
    });

    t.test('Should perform a bulk request (failure)', async (t) => {
      async function handler(req, res) {
        t.equal(req.url, '/_bulk');
        t.match(req.headers, { 'content-type': 'application/x-ndjson' });

        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
          body += chunk;
        }
        const [, payload] = body.split('\n');

        res.setHeader('content-type', 'application/json');

        if (JSON.parse(payload).user === 'arya') {
          res.end(
            JSON.stringify({
              took: 0,
              errors: true,
              items: [
                {
                  index: {
                    status: 400,
                    error: { something: 'went wrong' },
                  },
                },
              ],
            })
          );
        } else {
          res.end(
            JSON.stringify({
              took: 0,
              errors: false,
              items: [{}],
            })
          );
        }
      }

      const [{ port }, server] = await buildServer(handler);
      const client = new Client({ node: `http://localhost:${port}` });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        wait: 10,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop(doc) {
          t.same(doc, {
            status: 400,
            error: { something: 'went wrong' },
            operation: { index: { _index: 'test' } },
            document: { user: 'arya', age: 18 },
            retried: false,
          });
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 2,
        retry: 0,
        failed: 1,
        aborted: false,
      });
      server.stop();
    });

    t.test('Server error', async (t) => {
      const MockConnection = connection.buildMockConnection({
        onRequest() {
          return {
            statusCode: 500,
            body: { somothing: 'went wrong' },
          };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const b = client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      try {
        await b;
        t.fail('Should throw');
      } catch (err) {
        t.ok(err instanceof errors.ResponseError);
      }
    });

    t.test('Server error (high flush size, to trigger the finish error)', async (t) => {
      const MockConnection = connection.buildMockConnection({
        onRequest() {
          return {
            statusCode: 500,
            body: { somothing: 'went wrong' },
          };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const b = client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 5000000,
        concurrency: 1,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      try {
        await b;
        t.fail('Should throw');
      } catch (err) {
        t.ok(err instanceof errors.ResponseError);
      }
    });

    t.test('Should abort a bulk request', async (t) => {
      async function handler(req, res) {
        t.equal(req.url, '/_bulk');
        t.match(req.headers, { 'content-type': 'application/x-ndjson' });

        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
          body += chunk;
        }
        const [, payload] = body.split('\n');

        res.setHeader('content-type', 'application/json');

        if (JSON.parse(payload).user === 'arya') {
          res.end(
            JSON.stringify({
              took: 0,
              errors: true,
              items: [
                {
                  index: {
                    status: 400,
                    error: { something: 'went wrong' },
                  },
                },
              ],
            })
          );
        } else {
          res.end(
            JSON.stringify({
              took: 0,
              errors: false,
              items: [{}],
            })
          );
        }
      }

      const [{ port }, server] = await buildServer(handler);
      const client = new Client({ node: `http://localhost:${port}` });
      const b = client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        wait: 10,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          b.abort();
        },
      });

      const result = await b;
      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 2,
        successful: 1,
        retry: 0,
        failed: 1,
        aborted: true,
      });
      server.stop();
    });

    t.test('Invalid operation', (t) => {
      t.plan(2);
      const MockConnection = connection.buildMockConnection({
        onRequest() {
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      client.helpers
        .bulk({
          datasource: dataset.slice(),
          flushBytes: 1,
          concurrency: 1,
          onDocument() {
            return {
              foo: { _index: 'test' },
            };
          },
        })
        .catch((err) => {
          t.ok(err instanceof errors.ConfigurationError);
          t.equal(err.message, "Bulk helper invalid action: 'foo'");
        });
    });

    t.test('Should use payload returned by `onDocument`', async (t) => {
      let count = 0;
      const updatedAt = '1970-01-01T12:00:00.000Z';
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, {
            'content-type': 'application/x-ndjson',
          });
          const [action, payload] = params.body.split('\n');
          t.same(JSON.parse(action), { index: { _index: 'test' } });
          t.same(JSON.parse(payload), { ...dataset[count++], updatedAt });
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const result = await client.helpers.bulk({
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        onDocument(doc) {
          return [
            {
              index: {
                _index: 'test',
              },
            },
            { ...doc, updatedAt },
          ];
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.end();
  });

  t.test('datasource as stream', (t) => {
    t.test('Should perform a bulk request', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, { 'content-type': 'application/x-ndjson' });
          const [action, payload] = params.body.split('\n');
          t.same(JSON.parse(action), { index: { _index: 'test', _id: count } });
          t.same(JSON.parse(payload), dataset[count++]);
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });
      const stream = createReadStream(
        join(__dirname, '..', '..', 'fixtures', 'small-dataset.ndjson'),
        'utf8'
      );

      let id = 0;
      const result = await client.helpers.bulk({
        datasource: stream.pipe(split()),
        flushBytes: 1,
        concurrency: 1,
        onDocument() {
          return {
            index: {
              _index: 'test',
              _id: id++,
            },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });

    t.end();
  });

  t.test('datasource as async generator', (t) => {
    t.test('Should perform a bulk request', async (t) => {
      let count = 0;
      const MockConnection = connection.buildMockConnection({
        onRequest(params) {
          t.equal(params.path, '/_bulk');
          t.match(params.headers, { 'content-type': 'application/x-ndjson' });
          const [action, payload] = params.body.split('\n');
          t.same(JSON.parse(action), { index: { _index: 'test' } });
          t.same(JSON.parse(payload), dataset[count++]);
          return { body: { errors: false, items: [{}] } };
        },
      });

      const client = new Client({
        node: 'http://localhost:9200',
        Connection: MockConnection,
      });

      async function* generator() {
        const data = dataset.slice();
        for (const doc of data) {
          yield doc;
        }
      }

      const result = await client.helpers.bulk({
        datasource: generator(),
        flushBytes: 1,
        concurrency: 1,
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
        onDrop() {
          t.fail('This should never be called');
        },
      });

      t.type(result.time, 'number');
      t.type(result.bytes, 'number');
      t.match(result, {
        total: 3,
        successful: 3,
        retry: 0,
        failed: 0,
        aborted: false,
      });
    });
    t.end();
  });

  t.end();
});

test('bulk create', (t) => {
  t.test('Should perform a bulk request', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.same(JSON.parse(action), { create: { _index: 'test', _id: count } });
        t.same(JSON.parse(payload), dataset[count++]);
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      onDocument() {
        return {
          create: {
            _index: 'test',
            _id: id++,
          },
        };
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.test('Should perform a bulk request', async (t) => {
    let count = 0;
    const updatedAt = '1970-01-01T12:00:00.000Z';
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.same(JSON.parse(action), { create: { _index: 'test', _id: count } });
        t.same(JSON.parse(payload), { ...dataset[count++], updatedAt });
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      onDocument(doc) {
        return [
          {
            create: {
              _index: 'test',
              _id: id++,
            },
          },
          { ...doc, updatedAt },
        ];
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.end();
});

test('bulk update', (t) => {
  t.test('Should perform a bulk request', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.same(JSON.parse(action), { update: { _index: 'test', _id: count } });
        t.same(JSON.parse(payload), { doc: dataset[count++], doc_as_upsert: true });
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      onDocument() {
        return [
          {
            update: {
              _index: 'test',
              _id: id++,
            },
          },
          {
            doc_as_upsert: true,
          },
        ];
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.test('Should perform a bulk request dataset as string)', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.same(JSON.parse(action), { update: { _index: 'test', _id: count } });
        t.same(JSON.parse(payload), { doc: dataset[count++] });
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.map((d) => JSON.stringify(d)),
      flushBytes: 1,
      concurrency: 1,
      onDocument() {
        return [
          {
            update: {
              _index: 'test',
              _id: id++,
            },
          },
        ];
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.test('Should track the number of noop results', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.strictEqual(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.deepEqual(JSON.parse(action), { update: { _index: 'test', _id: count } });
        t.deepEqual(JSON.parse(payload), { doc: dataset[count++], doc_as_upsert: true });
        return { body: { errors: false, items: [{ update: { result: 'noop' } }] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      onDocument() {
        return [
          {
            update: {
              _index: 'test',
              _id: id++,
            },
          },
          {
            doc_as_upsert: true,
          },
        ];
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      noop: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.end();
});

test('bulk delete', (t) => {
  t.test('Should perform a bulk request', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        t.same(JSON.parse(params.body), { delete: { _index: 'test', _id: count++ } });
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      onDocument() {
        return {
          delete: {
            _index: 'test',
            _id: id++,
          },
        };
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.test('Should perform a bulk request (failure)', async (t) => {
    async function handler(req, res) {
      t.equal(req.url, '/_bulk');
      t.match(req.headers, { 'content-type': 'application/x-ndjson' });

      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
      }

      res.setHeader('content-type', 'application/json');

      if (JSON.parse(body).delete._id === 1) {
        res.end(
          JSON.stringify({
            took: 0,
            errors: true,
            items: [
              {
                delete: {
                  status: 400,
                  error: { something: 'went wrong' },
                },
              },
            ],
          })
        );
      } else {
        res.end(
          JSON.stringify({
            took: 0,
            errors: false,
            items: [{}],
          })
        );
      }
    }

    const [{ port }, server] = await buildServer(handler);
    const client = new Client({ node: `http://localhost:${port}` });
    let id = 0;
    const result = await client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      wait: 10,
      onDocument() {
        return {
          delete: {
            _index: 'test',
            _id: id++,
          },
        };
      },
      onDrop(doc) {
        t.same(doc, {
          status: 400,
          error: { something: 'went wrong' },
          operation: { delete: { _index: 'test', _id: 1 } },
          document: null,
          retried: false,
        });
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 2,
      retry: 0,
      failed: 1,
      aborted: false,
    });
    server.stop();
  });

  t.end();
});

test('transport options', (t) => {
  t.test('Should pass transport options in request', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        count++;

        if (params.path === '/_bulk') {
          t.match(params.headers, {
            'content-type': 'application/x-ndjson',
            foo: 'bar',
          });
          return { body: { errors: false, items: [{}] } };
        }

        t.equal(params.path, '/_all/_refresh');
        t.match(params.headers, {
          foo: 'bar',
        });
        return { body: {} };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });

    const result = await client.helpers.bulk(
      {
        datasource: dataset.slice(),
        flushBytes: 1,
        concurrency: 1,
        onDocument() {
          return { index: { _index: 'test' } };
        },
        onDrop() {
          t.fail('This should never be called');
        },
        refreshOnCompletion: true,
      },
      {
        headers: {
          foo: 'bar',
        },
      }
    );

    t.equal(count, 4); // three bulk requests, one refresh
    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.end();
});

test('errors', (t) => {
  t.test('datasource type', async (t) => {
    const client = new Client({
      node: 'http://localhost:9200',
    });
    try {
      await client.helpers.bulk({
        datasource: 'hello',
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
      });
    } catch (err) {
      t.ok(err instanceof errors.ConfigurationError);
      t.equal(
        err.message,
        'bulk helper: the datasource must be an array or a buffer or a readable stream or an async generator'
      );
    }
  });

  t.test('missing datasource', async (t) => {
    const client = new Client({
      node: 'http://localhost:9200',
    });
    try {
      await client.helpers.bulk({
        onDocument() {
          return {
            index: { _index: 'test' },
          };
        },
      });
    } catch (err) {
      t.ok(err instanceof errors.ConfigurationError);
      t.equal(err.message, 'bulk helper: the datasource is required');
    }
  });

  t.test('missing onDocument', async (t) => {
    const client = new Client({
      node: 'http://localhost:9200',
    });
    try {
      await client.helpers.bulk({
        datasource: dataset.slice(),
      });
    } catch (err) {
      t.ok(err instanceof errors.ConfigurationError);
      t.equal(err.message, 'bulk helper: the onDocument callback is required');
    }
  });

  t.end();
});

test('Flush interval', (t) => {
  t.test('Slow producer', async (t) => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    t.teardown(() => clock.uninstall());

    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.same(JSON.parse(action), { index: { _index: 'test' } });
        t.same(JSON.parse(payload), dataset[count++]);
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });

    const result = await client.helpers.bulk({
      datasource: (async function* generator() {
        for (const chunk of dataset) {
          await clock.nextAsync();
          yield chunk;
        }
      })(),
      flushBytes: 5000000,
      concurrency: 1,
      onDocument() {
        return {
          index: { _index: 'test' },
        };
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.test('Abort operation', async (t) => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    t.teardown(() => clock.uninstall());

    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.ok(count < 2);
        t.equal(params.path, '/_bulk');
        t.match(params.headers, { 'content-type': 'application/x-ndjson' });
        const [action, payload] = params.body.split('\n');
        t.same(JSON.parse(action), { index: { _index: 'test' } });
        t.same(JSON.parse(payload), dataset[count++]);
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });

    const b = client.helpers.bulk({
      datasource: (async function* generator() {
        for (const chunk of dataset) {
          await clock.nextAsync();
          if (chunk.user === 'tyrion') {
            // Needed otherwise in Node.js 10
            // the second request will never be sent
            await Promise.resolve();
            b.abort();
          }
          yield chunk;
        }
      })(),
      flushBytes: 5000000,
      concurrency: 1,
      onDocument() {
        return {
          index: { _index: 'test' },
        };
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });

    const result = await b;

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, {
      total: 2,
      successful: 2,
      retry: 0,
      failed: 0,
      aborted: true,
    });
  });

  t.test('Operation stats', async (t) => {
    let count = 0;
    const MockConnection = connection.buildMockConnection({
      onRequest(params) {
        t.strictEqual(params.path, '/_bulk');
        t.match(params.headers, {
          'content-type': 'application/x-ndjson',
        });
        const [action, payload] = params.body.split('\n');
        t.deepEqual(JSON.parse(action), { index: { _index: 'test' } });
        t.deepEqual(JSON.parse(payload), dataset[count++]);
        return { body: { errors: false, items: [{}] } };
      },
    });

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection,
    });
    const b = client.helpers.bulk({
      datasource: dataset.slice(),
      flushBytes: 1,
      concurrency: 1,
      onDocument() {
        return {
          index: { _index: 'test' },
        };
      },
      onDrop() {
        t.fail('This should never be called');
      },
    });
    const result = await b;

    t.type(result.time, 'number');
    t.type(result.bytes, 'number');
    t.match(result, b.stats);
    t.match(result, {
      total: 3,
      successful: 3,
      retry: 0,
      failed: 0,
      aborted: false,
    });
  });

  t.end();
});
