/**
 * WeatherCorp RAP — port 4001
 *
 * org_id : weathercorp
 * domain : weathercorp.demo
 * key_id : weathercorp-root-key  (match what you typed in the frontend)
 *
 * Start:
 *   PRIVATE_KEY_FILE=./weathercorp-private.pem npm run a2a:rap:weather
 */
import { startRap } from './rap.js';

startRap({
  port:   4001,
  orgId:  'weathercorp',
  domain: 'weathercorp.demo',
  keyId:  process.env['KEY_ID'] ?? 'weathercorp-root-key',
});
