#!/usr/bin/env node
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module.js';
import { loadUserEnvironment } from './config/environment.js';

loadUserEnvironment();

await CommandFactory.run(CliModule, {
  cliName: 'cortes-eb',
  logger: ['error'],
});
