import { createSchema, createDocumentCodec } from '../model';
import { starterDefinitions } from './starter-definitions';

export const demoSchema = createSchema({ extensions: starterDefinitions });

export const demoDocumentCodec = createDocumentCodec(demoSchema);
