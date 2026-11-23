import { describe, expect, it } from 'vitest';
import { buildLaunchAgent, buildUnit, serviceSupported } from './publish-service.js';

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

describe('buildLaunchAgent', () => {
  const base = {
    node: '/opt/homebrew/bin/node',
    main: '/Users/u/cortes eb/dist/main.js',
    home: '/Users/u/.cortes-eb',
    limits: { maxPerDay: 4, minGapMs: 20 * 60_000 },
  };

  it('starts the live worker at login with the chosen limits and home', () => {
    const agent = buildLaunchAgent(base);
    expect(agent).toContain('<string>com.cortes-eb.publish</string>');
    expect(agent).toContain(
      [
        '    <string>/opt/homebrew/bin/node</string>',
        '    <string>/Users/u/cortes eb/dist/main.js</string>',
        '    <string>queue</string>',
        '    <string>run</string>',
        '    <string>--live</string>',
        '    <string>--max-per-day</string>',
        '    <string>4</string>',
        '    <string>--min-gap</string>',
        '    <string>20</string>',
      ].join('\n'),
    );
    expect(agent).toContain('<key>CORTES_EB_HOME</key>\n    <string>/Users/u/.cortes-eb</string>');
    expect(agent).toContain('<string>/Users/u/.cortes-eb/bin:/opt/homebrew/bin:');
    expect(agent).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(agent).toContain('<string>/Users/u/.cortes-eb/logs/publish.log</string>');
  });

  it('rejects paths that could break the property list', () => {
    for (const bad of ['relativo/main.js', '/a<b', '/a&b', '/a"b', "/a'b", '/a\nb']) {
      expect(() => buildLaunchAgent({ ...base, main: bad })).toThrow();
    }
  });
});

describe('serviceSupported', () => {
  it('runs on Linux and Mac and asks Windows to keep a terminal open', () => {
    expect(serviceSupported('linux')).toBe(true);
    expect(serviceSupported('darwin')).toBe(true);
    expect(serviceSupported('win32')).toBe(false);
  });
});
