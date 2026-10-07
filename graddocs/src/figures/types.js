// Figure type registry. Add a new academic diagram type with
// registerFigureType({ id, name, icon, description, template, libraryGroups }).
// `name`/`description` are UI text (pass them through t()); `defaultTitle` is the
// English text prefilled as the title of a new figure (report content, never translated).
import { t } from '../i18n/index.js';
import * as T from './templates/index.js';

const TYPES = new Map();

export function registerFigureType(def) {
  TYPES.set(def.id, { libraryGroups: ['Basic'], defaultTitle: def.name, ...def });
}

export const getFigureType = (id) => TYPES.get(id) || TYPES.get('generic');
export const figureTypes = () => [...TYPES.values()];

registerFigureType({ id: 'flowchart', name: t('Flowchart'), defaultTitle: 'Flowchart', icon: 'tFlow', description: t('Processes, decisions and flows.'), template: T.flowchartTemplate, libraryGroups: ['Flowchart', 'Basic'] });
registerFigureType({ id: 'usecase', name: t('Use Case Diagram'), defaultTitle: 'Use Case Diagram', icon: 'tUseCase', description: t('Actors, use cases and the system boundary.'), template: T.useCaseTemplate, libraryGroups: ['UML', 'Basic'] });
registerFigureType({ id: 'activity', name: t('Activity Diagram'), defaultTitle: 'Activity Diagram', icon: 'tActivity', description: t('Actions, decisions, forks and joins.'), template: T.activityTemplate, libraryGroups: ['UML', 'Flowchart'] });
registerFigureType({ id: 'sequence', name: t('Sequence Diagram'), defaultTitle: 'Sequence Diagram', icon: 'tSequence', description: t('Lifelines and ordered messages.'), template: T.sequenceTemplate, libraryGroups: ['UML'] });
registerFigureType({ id: 'class', name: t('Class Diagram'), defaultTitle: 'Class Diagram', icon: 'tClass', description: t('Classes, attributes, operations and relations.'), template: T.classTemplate, libraryGroups: ['UML'] });
registerFigureType({ id: 'state', name: t('State Diagram'), defaultTitle: 'State Diagram', icon: 'tState', description: t('States and transitions.'), template: T.stateTemplate, libraryGroups: ['UML'] });
registerFigureType({ id: 'erd', name: t('ER Diagram'), defaultTitle: 'ER Diagram', icon: 'tER', description: t('Entities, keys and crow’s-foot relations.'), template: T.erdTemplate, libraryGroups: ['ERD'] });
registerFigureType({ id: 'architecture', name: t('System Architecture'), defaultTitle: 'System Architecture', icon: 'tArch', description: t('Layers, services, clients and storage.'), template: T.architectureTemplate, libraryGroups: ['Architecture', 'Basic'] });
registerFigureType({ id: 'component', name: t('Component Diagram'), defaultTitle: 'Component Diagram', icon: 'tComponent', description: t('Components and their dependencies.'), template: T.componentTemplate, libraryGroups: ['UML', 'Architecture'] });
registerFigureType({ id: 'deployment', name: t('Deployment Diagram'), defaultTitle: 'Deployment Diagram', icon: 'tDeploy', description: t('Nodes, devices and deployed artifacts.'), template: T.deploymentTemplate, libraryGroups: ['UML', 'Architecture'] });
registerFigureType({ id: 'fishbone', name: t('Fishbone Diagram'), defaultTitle: 'Fishbone Diagram', icon: 'tFishbone', description: t('Cause-and-effect / feature breakdown.'), template: T.fishboneTemplate, libraryGroups: ['Basic'] });
registerFigureType({ id: 'hierarchy', name: t('Hierarchy / Organization'), defaultTitle: 'Hierarchy / Organization', icon: 'tHierarchy', description: t('Org charts, WBS and module trees.'), template: T.hierarchyTemplate, libraryGroups: ['Basic'] });
registerFigureType({ id: 'timeline', name: t('Timeline / Gantt'), defaultTitle: 'Timeline / Gantt', icon: 'tTimeline', description: t('Project schedule with tasks and months.'), template: T.timelineTemplate, libraryGroups: ['Basic'] });
registerFigureType({ id: 'generic', name: t('Generic Diagram'), defaultTitle: 'Generic Diagram', icon: 'tGeneric', description: t('Blank canvas — draw anything.'), template: T.genericTemplate, libraryGroups: ['Basic', 'Flowchart', 'UML', 'ERD', 'Architecture'] });

/** The font settings new diagrams start with (Settings → Figures). */
export function figureFonts(project) {
  const fd = project?.settings?.figureDefaults || {};
  return { fontFamily: fd.fontFamily || 'Times New Roman', fontSize: Number(fd.fontSize) || 14 };
}

/** Build a fresh diagram for a figure type using the project's figure defaults. */
export function buildTemplate(typeId, project) {
  return getFigureType(typeId).template(figureFonts(project));
}
