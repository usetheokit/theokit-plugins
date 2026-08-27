/**
 * Controller surface for `@theokit/plugin-payments`.
 *
 * Split from the package root so the decorator runtime (`@theokit/http`, an OPTIONAL peer) is only
 * loaded by an app that extends the controller. An app calling `processWebhook` directly installs
 * nothing extra.
 */
export { StripeWebhookControllerBase } from './webhook-controller.js'
