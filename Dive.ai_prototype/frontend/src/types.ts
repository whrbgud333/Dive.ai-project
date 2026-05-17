export interface AiFlags {
  name: boolean;
  personality: boolean;
  appearance: boolean;
  background: boolean;
  gender: boolean;
  age: boolean;
}

export interface CharacterInput {
  name: string;
  personality: string;
  appearance: string;
  background: string;
  gender: string;
  age: string;
  aiFlags: AiFlags;
}

export interface CharacterResult {
  name: string;
  role: string;
  personality: string;
  appearance: string;
  background: string;
  gender: string;
  age: string;
  image?: string;
}

export interface SupportingCharacter {
  name: string;
  role?: string;
  gender?: string;
  age?: string;
  personality?: string;
  appearance?: string;
  background?: string;
  relationship?: string;
  importance?: string;
}

export interface Scenario {
  기: string;
  승: string;
  전: string;
  결: string;
}

export interface SessionOptions {
  model: string;
  tone: string;
  impersonation: boolean;
  outputLength: number;
}

export interface FlowData {
  // 화면 1
  contentType: string;
  genre: string;
  classicCountry: string;

  // 화면 2
  material: string;
  materialByAI: boolean;
  aiCharacterInput: CharacterInput;
  userCharacterInput: CharacterInput;

  // 화면 4 (빌더 결과)
  storyLength: 'short' | 'normal' | 'long';
  scenario: Scenario;
  introDisplay: string;
  aiCharacterResult: CharacterResult;
  userCharacterResult: CharacterResult;
  supportingCast: SupportingCharacter[];
  topicId: number | null;
  topicTitle: string;
  coverImage?: string;
  coverImages?: string[];
  bgm_url?: string;
  bgm_urls?: { [stage: string]: string };

  // 화면 5
  userPersona: {
    name: string;
    personality: string;
    background: string;
    appearance: string;
    gender: string;
    age: string;
    image?: string;
  };
  userNotes: string;
  sessionOptions: SessionOptions;
}

export const defaultFlowData = (): FlowData => ({
  contentType: '',
  genre: '',
  classicCountry: '',
  material: '',
  materialByAI: false,
  aiCharacterInput: {
    name: '', personality: '', appearance: '', background: '', gender: '', age: '',
    aiFlags: { name: true, personality: true, appearance: true, background: true, gender: true, age: true },
  },
  userCharacterInput: {
    name: '', personality: '', appearance: '', background: '', gender: '', age: '',
    aiFlags: { name: false, personality: false, appearance: false, background: false, gender: false, age: false },
  },
  storyLength: 'normal',
  scenario: { 기: '', 승: '', 전: '', 결: '' },
  introDisplay: '',
  aiCharacterResult: { name: '', role: '', personality: '', appearance: '', background: '', gender: '', age: '' },
  userCharacterResult: { name: '', role: '', personality: '', appearance: '', background: '', gender: '', age: '' },
  supportingCast: [],
  topicId: null,
  topicTitle: '',
  coverImage: '',
  userPersona: { name: '', personality: '', background: '', appearance: '', gender: '', age: '', image: '' },
  userNotes: '',
  sessionOptions: {
    model: 'gemini-3.1-flash-lite-preview-vertex',
    tone: '',
    impersonation: false,
    outputLength: 1024,
  },
});
