import { GoogleGenAI, Type } from '@google/genai';
import {
  normalizeCharacterSpec,
  parseCharacterPromptFallback,
} from '../src/shared/characterParser';
import {
  CharacterArtStyle,
  CharacterSpecification,
  GenerationMode,
  QualityConfig,
} from '../src/shared/types';

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function interpretCharacterDescription(
  prompt: string,
  options: {
    mode: GenerationMode;
    interpreterProvider?: string;
    geometryProvider?: string;
    artStyle?: CharacterArtStyle;
    qualityConfig?: Partial<QualityConfig>;
  }
): Promise<{
  spec: CharacterSpecification;
  usedFallback: boolean;
  providerUsed: string;
  note: string;
}> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) {
    throw new Error('Character description cannot be empty.');
  }

  const wantsLocalOnly =
    options.mode === 'local' || options.interpreterProvider === 'local-semantic-parser';

  const ai = wantsLocalOnly ? null : createGeminiClient();

  if (!ai) {
    const spec = parseCharacterPromptFallback(cleanPrompt, {
      interpreterProvider: 'local-semantic-parser',
      geometryProvider: options.geometryProvider || 'sculpted-anatomical-vrm',
      artStyle: options.artStyle,
      qualityConfig: options.qualityConfig,
    });
    return {
      spec,
      usedFallback: true,
      providerUsed: 'local-semantic-parser',
      note: wantsLocalOnly
        ? 'Interpreted locally via deterministic semantic character parser (Offline/Local Mode).'
        : 'Interpreted via local semantic character parser (Gemini API key not active in environment).',
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Convert this character description into a structured 3D humanoid VRM 1.0 character specification. Infer plausible hex colors, body proportions, hair style, outfit style, and anatomical features faithfully without dropping any user-specified traits.\n\nDescription: "${cleanPrompt}"`,
      config: {
        systemInstruction:
          'You are a 3D character technical director. Output strict JSON matching the schema. Keep heightMeters between 1.45 and 2.10, proportions around 0.85-1.25, and all colors as 6-digit hex codes like #cbb8e6. CRITICAL: Never introduce unrequested features such as wings, horns, tails, or extra armor (set hasWings/hasHorns/hasTail to false unless explicitly requested in the prompt), and treat all user-specified colors, species, and outfit details as authoritative.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Fitting character name' },
            species: { type: Type.STRING },
            genderPresentation: {
              type: Type.STRING,
              description: 'One of: feminine, masculine, androgynous',
            },
            ageAppearance: {
              type: Type.STRING,
              description: 'One of: young_adult, adult, mature',
            },
            build: {
              type: Type.STRING,
              description: 'One of: slender, athletic, average, muscular, heavy',
            },
            artStyle: {
              type: Type.STRING,
              description: 'One of: semi_realistic, stylized_anime, realistic_human',
            },
            aesthetic: { type: Type.STRING },
            hairStyle: {
              type: Type.STRING,
              description: 'One of: long_flowing, bob, short_crop, ponytail, braided, spiky',
            },
            outfitStyle: {
              type: Type.STRING,
              description:
                'One of: ornate_armor_cloak, fantasy_robe, cyber_tactical, casual_modern, royal_regalia',
            },
            proportions: {
              type: Type.OBJECT,
              properties: {
                heightMeters: { type: Type.NUMBER },
                shoulderWidthScale: { type: Type.NUMBER },
                hipWidthScale: { type: Type.NUMBER },
                limbLengthScale: { type: Type.NUMBER },
                headScale: { type: Type.NUMBER },
              },
            },
            palette: {
              type: Type.OBJECT,
              properties: {
                skinColor: { type: Type.STRING },
                hairColor: { type: Type.STRING },
                eyeColor: { type: Type.STRING },
                eyeEmissive: { type: Type.BOOLEAN },
                primaryOutfitColor: { type: Type.STRING },
                secondaryOutfitColor: { type: Type.STRING },
                accentMetallicColor: { type: Type.STRING },
                cloakColor: { type: Type.STRING },
              },
            },
            features: {
              type: Type.OBJECT,
              properties: {
                earStyle: {
                  type: Type.STRING,
                  description: 'One of: human, pointed_elf, long_elf',
                },
                hasCloak: { type: Type.BOOLEAN },
                hasArmor: { type: Type.BOOLEAN },
                hasWings: { type: Type.BOOLEAN },
                hasTail: { type: Type.BOOLEAN },
                hasHorns: { type: Type.BOOLEAN },
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<CharacterSpecification>;
    const baseFallback = parseCharacterPromptFallback(cleanPrompt, {
      artStyle: options.artStyle,
      qualityConfig: options.qualityConfig,
    });
    const spec = normalizeCharacterSpec(
      {
        ...parsed,
        artStyle: options.artStyle ?? parsed.artStyle ?? baseFallback.artStyle,
        qualityConfig: baseFallback.qualityConfig,
        interpreterProvider: 'gemini-4-hydrogen',
        geometryProvider: options.geometryProvider || 'sculpted-anatomical-vrm',
      },
      cleanPrompt
    );

    return {
      spec,
      usedFallback: false,
      providerUsed: 'gemini-4-hydrogen',
      note: 'Structured character specification generated by Gemini 4 Hydrogen.',
    };
  } catch (err) {
    const spec = parseCharacterPromptFallback(cleanPrompt, {
      interpreterProvider: 'local-semantic-parser',
      geometryProvider: options.geometryProvider || 'sculpted-anatomical-vrm',
      artStyle: options.artStyle,
      qualityConfig: options.qualityConfig,
    });
    return {
      spec,
      usedFallback: true,
      providerUsed: 'local-semantic-parser',
      note: `Gemini fallback engaged (${(err as Error).message}); parsed locally with full trait fidelity.`,
    };
  }
}
