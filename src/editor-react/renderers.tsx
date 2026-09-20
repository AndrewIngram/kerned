import type {ComponentType} from 'react';

export type ReactRenderer<Value>={name:string;component:ComponentType<{value:Value}>};
/** Registration is independent of schema storage. Components may return DOM,
 * CanvasPrimitive registrations, or both. Create the registry outside render.
 */
export function createReactRenderers<Value>(extensions:readonly ReactRenderer<Value>[]){
  const registry=new Map<string,ComponentType<{value:Value}>>();
  for(const extension of extensions){
    if(!extension.name||registry.has(extension.name))throw new Error(`Duplicate or empty renderer: ${extension.name}`);
    registry.set(extension.name,extension.component);
  }
  return function ExtensionView({type,value}:{type:string;value:Value}){
    const Component=registry.get(type);
    if(!Component)throw new Error(`No React renderer registered for ${type}`);
    return <Component value={value}/>;
  };
}
