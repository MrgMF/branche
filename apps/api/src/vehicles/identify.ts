// Identification d'un véhicule sur une photo par l'API Anthropic Messages (modèle vision).
// L'image est transmise au sous-traitant pour la seule durée de la requête : jamais stockée ni journalisée ici.
import { fetchWithTimeout, type FetchLike } from '../lib/ttlCache.js';
import { VEHICLE_CATALOG } from './catalog.js';

export type IdentifyMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface IdentifyResult {
  vehicleId: string | null;
  confidence: 'haute' | 'moyenne' | 'faible';
}

export class IdentifyError extends Error {}

export interface VehicleIdentifier {
  identify(imageBase64: string, mediaType: IdentifyMediaType): Promise<IdentifyResult>;
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TOOL = 'identifier_vehicule';

export class AnthropicVehicleIdentifier implements VehicleIdentifier {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: FetchLike,
    private readonly url = ANTHROPIC_URL,
  ) {}

  async identify(imageBase64: string, mediaType: IdentifyMediaType): Promise<IdentifyResult> {
    const ids = VEHICLE_CATALOG.map((v) => v.id);
    const body = {
      model: this.model,
      max_tokens: 200,
      // Sortie contrainte : un outil imposé dont l'identifiant est une énumération fermée (VEHICLES ou « inconnu »).
      tools: [
        {
          name: TOOL,
          description: 'Renvoie le modèle de véhicule électrique visible sur la photo.',
          input_schema: {
            type: 'object',
            properties: {
              vehicleId: { type: 'string', enum: [...ids, 'inconnu'] },
              confidence: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
            },
            required: ['vehicleId', 'confidence'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            {
              type: 'text',
              text:
                'Quelle voiture électrique est sur cette photo ? Choisis UNIQUEMENT parmi cette liste (identifiant : nom), ' +
                'sinon réponds « inconnu » (pas une voiture, modèle absent, photo illisible ou doute) :\n' +
                VEHICLE_CATALOG.map((v) => `${v.id} : ${v.name}`).join('\n'),
            },
          ],
        },
      ],
    };
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.fetchFn,
        this.url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(body),
        },
        20_000,
      );
    } catch {
      throw new IdentifyError('réseau');
    }
    if (!res.ok) throw new IdentifyError(`HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as { content?: { type: string; name?: string; input?: Record<string, unknown> }[] } | null;
    const call = json?.content?.find((c) => c.type === 'tool_use' && c.name === TOOL);
    const id = typeof call?.input?.vehicleId === 'string' ? call.input.vehicleId : 'inconnu';
    const conf = call?.input?.confidence;
    return {
      vehicleId: ids.includes(id) ? id : null,
      confidence: conf === 'haute' || conf === 'moyenne' ? conf : 'faible',
    };
  }
}
