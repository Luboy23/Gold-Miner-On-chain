import type { ChallengeHubActionConfig, ChallengeHubLayout, ChallengeHubLayoutConfig } from './challengeHubLayout';
import type { RankedBoardSectionViewModel, RankedUiTone } from './types/index';

export interface ChallengeHubViewModel {
  header: ChallengeHubLayoutConfig;
  leftSection: {
    prefix: string;
    section: RankedBoardSectionViewModel;
  };
  rightSection: {
    prefix: string;
    section: RankedBoardSectionViewModel;
  };
  status: {
    text: string;
    tone: RankedUiTone;
  };
  actions: ChallengeHubActionConfig;
}

export function applyChallengeHubViewModel(
  layout: ChallengeHubLayout,
  model: ChallengeHubViewModel,
): void {
  layout.setHeader(model.header);
  layout.setSection('left', model.leftSection.prefix, model.leftSection.section);
  layout.setSection('right', model.rightSection.prefix, model.rightSection.section);
  layout.setStatus(model.status.text, model.status.tone);
  layout.configureActions(model.actions);
}
