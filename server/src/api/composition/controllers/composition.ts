import { factories } from '@strapi/strapi';

// Cast at the boundary: the `api::composition.composition` UID isn't in
// the ContentType union until Strapi regenerates types on first build.
export default factories.createCoreController('api::composition.composition' as never);
