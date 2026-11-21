import { describe, expect, it } from 'vitest';
import { buildUnit } from './publish-service.js';

describe('buildUnit', () => {
  const base = {
    node: '/usr/bin/node',
    main: '/opt/cortes eb/dist/main.js',
    home: '/home/u/.cortes-eb',
    limits: { maxPerDay: 5, minGapMs: 45 * 60_000 },
  };

  it('runs the live worker with the chosen limits and home', () => {
    const unit = buildUnit(base);
    expect(unit).toContain(
      'ExecStart="/usr/bin/node" "/opt/cortes eb/dist/main.js" queue run --live --max-per-day 5 --min-gap 45',
    );
    expect(unit).toContain('Environment="CORTES_EB_HOME=/home/u/.cortes-eb"');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('rejects paths that could break or inject into the unit file', () => {
    for (const bad of ['relativo/main.js', '/a"b', '/a\nExecStart=/bin/sh', '/a%h', '/a\\b']) {
      expect(() => buildUnit({ ...base, main: bad })).toThrow();
    }
  });
});
