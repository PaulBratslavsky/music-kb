import { factories } from '@strapi/strapi';

// Strapi regenerates content-type types on `develop`/`build`. Until the
// first build populates .strapi/types, the `api::note.note` UID isn't in
// the ContentType union yet — cast at the boundary so TS doesn't block
// the initial compile.
export default factories.createCoreController('api::note.note' as never);
