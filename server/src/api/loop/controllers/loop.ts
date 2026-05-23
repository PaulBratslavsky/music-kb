import { factories } from '@strapi/strapi';

// Strapi regenerates content-type types on `develop`/`build`. Until the
// first build populates .strapi/types, the `api::loop.loop` UID isn't in
// the ContentType union yet — cast at the boundary so TS doesn't block
// the initial compile.
export default factories.createCoreController('api::loop.loop' as never);
