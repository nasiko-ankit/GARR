/**
 * TranslateHub RAP — port 4002
 *
 * org_id : translatehub
 * domain : translatehub.demo
 * key_id : translatehub-root-key  (match what you typed in the frontend)
 *
 * Start:
 *   PRIVATE_KEY_FILE=./translatehub-private.pem npm run a2a:rap:translate
 */
import { startRap } from './rap.js';

startRap({
  port:   4002,
  orgId:  'translatehub',
  domain: 'translatehub.demo',
  keyId:  process.env['KEY_ID'] ?? 'translatehub-root-key',
});
