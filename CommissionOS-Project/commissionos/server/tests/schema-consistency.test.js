// Makes sure schema.prisma, the UI<->column mapping and the seed data agree with each other.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { COLLECTIONS, SINGLETONS, toRow, fromRow } = require('../src/lib/collections');

const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
const seed = require('../prisma/seed-data.json');

function parseModels() {
  const models = {};
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = {};
    for (const line of m[2].split('\n')) {
      const f = line.trim().match(/^(\w+)\s+(\w+)(\?|\[\])?/);
      if (f && !line.trim().startsWith('//') && !line.trim().startsWith('@@')) fields[f[1]] = f[2];
    }
    models[m[1]] = fields;
  }
  return models;
}
const models = parseModels();
const prismaType = { string: 'String', number: 'Float', boolean: 'Boolean', json: 'Json' };
const modelName = (delegate) => delegate[0].toUpperCase() + delegate.slice(1);

test('every mapped column exists in schema.prisma with a compatible type', () => {
  for (const [name, cfg] of [...Object.entries(COLLECTIONS), ...Object.entries(SINGLETONS)]) {
    const fields = models[modelName(cfg.model)];
    assert.ok(fields, `${name}: model ${modelName(cfg.model)} missing in schema`);
    assert.ok(fields.extra === 'Json', `${name}: needs an extra Json column`);
    for (const [uiKey, [type, pk]] of Object.entries(cfg.cols)) {
      assert.ok(fields[pk], `${name}.${uiKey}: column "${pk}" missing in schema`);
      assert.strictEqual(fields[pk], prismaType[type], `${name}.${uiKey}: schema type ${fields[pk]} != ${prismaType[type]}`);
    }
    if (cfg.idKey) assert.ok(cfg.cols[cfg.idKey], `${name}: idKey not mapped`);
  }
});

test('ordered collections have a createdAt column', () => {
  for (const [name, cfg] of Object.entries(COLLECTIONS)) {
    assert.strictEqual(models[modelName(cfg.model)].createdAt, 'DateTime', `${name}: createdAt missing`);
  }
});

test('seed data round-trips through toRow/fromRow without losing fields', () => {
  for (const [name, cfg] of Object.entries(COLLECTIONS)) {
    const ids = new Set();
    for (const item of seed[name] || []) {
      assert.ok(!ids.has(item[cfg.idKey]), `${name}: duplicate id ${item[cfg.idKey]}`);
      ids.add(item[cfg.idKey]);
      const row = toRow(cfg, item);
      const back = fromRow(cfg, { ...row, createdAt: new Date() });
      for (const [k, v] of Object.entries(item)) {
        assert.deepStrictEqual(back[k], v, `${name}.${item[cfg.idKey]}.${k} changed after round-trip`);
      }
    }
  }
  for (const [name, cfg] of Object.entries(SINGLETONS)) {
    const back = fromRow(cfg, toRow(cfg, seed[name]));
    assert.deepStrictEqual(back, seed[name], `${name} changed after round-trip`);
  }
});
