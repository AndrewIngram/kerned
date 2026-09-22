import { createSchema, createDocumentCodec } from '@gprose/model';

import { starterDefinitions } from './starter-definitions';

export const demoSchema = createSchema({ extensions: starterDefinitions });

export const demoDocumentCodec = createDocumentCodec(demoSchema);
