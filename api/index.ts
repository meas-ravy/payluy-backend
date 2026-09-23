import '../src/lib/env'; // must stay the first import: loads .env when the host has no env vars
import { buildApp } from '../src/app';
import { buildContainer } from '../src/container';

export default buildApp(buildContainer());
