// Figure type registry. Add a new academic diagram type with
// registerFigureType({ id, name, icon, description, template, libraryGroups }).
import * as T from './templates/index.js';

const TYPES = new Map();

export function registerFigureType(def) {
  TYPES.set(def.id, { libraryGroups: ['Basic'], ...def });
}

export const getFigureType = (id) => TYPES.get(id) || TYPES.get('generic');
export const figureTypes = () => [...TYPES.values()];

registerFigureType({ id: 'flowchart', name: 'Flowchart', icon: 'tFlow', description: 'Processes, decisions and flows.', template: T.flowchartTemplate, libraryGroups: ['Flowchart', 'Basic'] });
registerFigureType({ id: 'usecase', name: 'Use Case Diagram', icon: 'tUseCase', description: 'Actors, use cases and the system boundary.', template: T.useCaseTemplate, libraryGroups: ['UML', 'Basic'] });
registerFigureType({ id: 'activity', name: 'Activity Diagram', icon: 'tActivity', description: 'Actions, decisions, forks and joins.', template: T.activityTemplate, libraryGroups: ['UML', 'Flowchart'] });
registerFigureType({ id: 'sequence', name: 'Sequence Diagram', icon: 'tSequence', description: 'Lifelines and ordered messages.', template: T.sequenceTemplate, libraryGroups: ['UML'] });
registerFigureType({ id: 'class', name: 'Class Diagram', icon: 'tClass', description: 'Classes, attributes, operations and relations.', template: T.classTemplate, libraryGroups: ['UML'] });
registerFigureType({ id: 'state', name: 'State Diagram', icon: 'tState', description: 'States and transitions.', template: T.stateTemplate, libraryGroups: ['UML'] });
registerFigureType({ id: 'erd', name: 'ER Diagram', icon: 'tER', description: 'Entities, keys and crow’s-foot relations.', template: T.erdTemplate, libraryGroups: ['ERD'] });
registerFigureType({ id: 'architecture', name: 'System Architecture', icon: 'tArch', description: 'Layers, services, clients and storage.', template: T.architectureTemplate, libraryGroups: ['Architecture', 'Basic'] });
registerFigureType({ id: 'component', name: 'Component Diagram', icon: 'tComponent', description: 'Components and their dependencies.', template: T.componentTemplate, libraryGroups: ['UML', 'Architecture'] });
registerFigureType({ id: 'deployment', name: 'Deployment Diagram', icon: 'tDeploy', description: 'Nodes, devices and deployed artifacts.', template: T.deploymentTemplate, libraryGroups: ['UML', 'Architecture'] });
registerFigureType({ id: 'fishbone', name: 'Fishbone Diagram', icon: 'tFishbone', description: 'Cause-and-effect / feature breakdown.', template: T.fishboneTemplate, libraryGroups: ['Basic'] });
registerFigureType({ id: 'hierarchy', name: 'Hierarchy / Organization', icon: 'tHierarchy', description: 'Org charts, WBS and module trees.', template: T.hierarchyTemplate, libraryGroups: ['Basic'] });
registerFigureType({ id: 'timeline', name: 'Timeline / Gantt', icon: 'tTimeline', description: 'Project schedule with tasks and months.', template: T.timelineTemplate, libraryGroups: ['Basic'] });
registerFigureType({ id: 'generic', name: 'Generic Diagram', icon: 'tGeneric', description: 'Blank canvas — draw anything.', template: T.genericTemplate, libraryGroups: ['Basic', 'Flowchart', 'UML', 'ERD', 'Architecture'] });

/** Build a fresh diagram for a figure type using the project's figure defaults. */
export function buildTemplate(typeId, project) {
  const fd = project?.settings?.figureDefaults || {};
  return getFigureType(typeId).template({ fontFamily: fd.fontFamily || 'Times New Roman', fontSize: Number(fd.fontSize) || 14 });
}
