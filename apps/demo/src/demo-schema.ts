import { createSchema, createDocumentCodec } from '@kerned/model';
import { starterDefinitions } from '@kerned/starter-kit';

export const demoSchema = createSchema({ extensions: starterDefinitions });

export const demoDocumentCodec = createDocumentCodec(demoSchema);
