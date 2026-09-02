import { factories } from '@strapi/strapi';

// Strapi regenerates content-type types on `develop`/`build`. Until the
// first build populates .strapi/types, the `api::chat-conversation.chat-conversation`
// UID isn't in the ContentType union yet — cast at the boundary so TS doesn't
// block the initial compile.
export default factories.createCoreController('api::chat-conversation.chat-conversation' as never);
