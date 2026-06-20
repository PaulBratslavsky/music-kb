import { factories } from '@strapi/strapi';

// Cast at the boundary: the `api::progression.progression` UID isn't in
// the ContentType union until Strapi regenerates types on first build.
export default factories.createCoreController('api::progression.progression' as never);
