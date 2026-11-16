#!/usr/bin/env node
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';

await CommandFactory.run(CliModule, {
  cliName: 'cortes-eb',
  logger: ['error'],
});
