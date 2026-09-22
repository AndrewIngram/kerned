import { createSchema, createDocumentCodec } from '@gprose/model';
import { starterDefinitions } from '@gprose/starter-kit';

export const demoSchema = createSchema({ extensions: starterDefinitions });

export const demoDocumentCodec = createDocumentCodec(demoSchema);
