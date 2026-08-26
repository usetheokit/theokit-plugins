/**
 * Controller surface for `@theokit/plugin-voice`.
 *
 * Split from the package root so the decorator runtime (`@theokit/http`, an OPTIONAL peer) is only
 * loaded by an app that actually extends the controller. An app using `handleSttRequest` directly
 * imports the root and installs nothing extra.
 */
export { VoiceControllerBase, ttsInputSchema } from './voice-controller.js'
