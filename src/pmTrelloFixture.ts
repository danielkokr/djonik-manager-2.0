import { EVAL_BOARD_NAME, type EvalBoardDriver, type EvalCard } from "./pmFixture.js";

type Row = Record<string, unknown>;
const marker = (key: string) => `[djonik-eval:${key}]`;
const idOf = (row: Row): string => {
  if (typeof row.id !== "string") throw new Error("Trello response lacks id");
  return row.id;
};

/** Explicit eval board id and dedicated credentials are required by the caller. No production fallback. */
export class TrelloEvalBoardDriver implements EvalBoardDriver {
  private readonly lists = new Map<string, string>();
  private readonly labels = new Map<string, string>();
  private readonly cards = new Map<string, string>();
  private sizeField: string | null = null;

  constructor(private readonly input: { boardId: string; apiKey: string; token: string; fetcher?: typeof fetch }) {
    if (!/^[0-9a-f]{24}$/i.test(input.boardId) || !input.apiKey || !input.token) throw new Error("Explicit eval Trello board and credentials required");
  }

  private async request(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    const url = new URL(`https://api.trello.com/1${path}`);
    for (const [key, value] of Object.entries({ ...query, key: this.input.apiKey, token: this.input.token })) url.searchParams.set(key, value);
    const response = await (this.input.fetcher ?? fetch)(url, {
      method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Trello eval ${method} ${path} returned HTTP ${response.status}`);
    const raw = await response.text();
    return raw ? JSON.parse(raw) as unknown : null;
  }

  async assertDedicatedBoard(name: typeof EVAL_BOARD_NAME): Promise<void> {
    const board = await this.request("GET", `/boards/${this.input.boardId}`, { fields: "name,closed" }) as Row;
    if (board.name !== name || board.closed !== false) throw new Error("Refusing to modify a non-eval or closed Trello board");
  }

  async ensureLists(names: readonly string[]): Promise<void> {
    const rows = await this.request("GET", `/boards/${this.input.boardId}/lists`, { filter: "open", fields: "name" }) as Row[];
    for (const name of names) {
      const matches = rows.filter((row) => row.name === name);
      if (matches.length > 1) throw new Error(`Duplicate eval list: ${name}`);
      const row = matches[0] ?? await this.request("POST", "/lists", { idBoard: this.input.boardId, name }) as Row;
      this.lists.set(name, idOf(row));
    }
  }

  async ensureProjectLabels(names: readonly EvalCard["project"][]): Promise<void> {
    const rows = await this.request("GET", `/boards/${this.input.boardId}/labels`, { limit: "1000" }) as Row[];
    for (const name of names) {
      const matches = rows.filter((row) => row.name === name);
      if (matches.length > 1) throw new Error(`Duplicate eval label: ${name}`);
      const row = matches[0] ?? await this.request("POST", "/labels", { idBoard: this.input.boardId, name, color: "null" }) as Row;
      this.labels.set(name, idOf(row));
    }
  }

  async ensureSizeField(): Promise<void> {
    const rows = await this.request("GET", `/boards/${this.input.boardId}/customFields`) as Row[];
    const matches = rows.filter((row) => row.name === "Size");
    if (matches.length > 1 || (matches.length === 1 && matches[0].type !== "text")) throw new Error("Eval Size field conflicts with fixture");
    const field = matches[0] ?? await this.request("POST", "/customFields", {
      idModel: this.input.boardId, modelType: "board", name: "Size", type: "text", pos: "bottom",
    }) as Row;
    this.sizeField = idOf(field);
  }

  async resetCards(cards: readonly EvalCard[]): Promise<void> {
    const rows = await this.request("GET", `/boards/${this.input.boardId}/cards`, { filter: "open", fields: "name,desc,idList,idLabels,due" }) as Row[];
    for (const card of cards) {
      const matches = rows.filter((row) => typeof row.desc === "string" && row.desc.includes(marker(card.key)));
      if (matches.length > 1) throw new Error(`Duplicate eval card identity: ${card.key}`);
      const idList = this.lists.get(card.list);
      const idLabel = this.labels.get(card.project);
      if (!idList || !idLabel) throw new Error("Eval lists/labels must be ensured before cards");
      const desired = { name: card.title, desc: marker(card.key), idList, idLabels: idLabel, due: card.due ?? "" };
      const existing = matches[0];
      const same = existing && existing.name === card.title && existing.desc === marker(card.key) && existing.idList === idList &&
        Array.isArray(existing.idLabels) && existing.idLabels.length === 1 && existing.idLabels[0] === idLabel &&
        (card.due ? Date.parse(String(existing.due)) === Date.parse(card.due) : existing.due === null);
      const row = same ? existing : existing
        ? await this.request("PUT", `/cards/${idOf(existing)}`, desired)
        : await this.request("POST", "/cards", { ...desired, idBoard: this.input.boardId }) as Row;
      const id = idOf(row as Row);
      this.cards.set(card.key, id);
      if (!this.sizeField) throw new Error("Eval Size field missing");
      const currentFields = await this.request("GET", `/cards/${id}/customFieldItems`) as Row[];
      const currentSize = currentFields.find((field) => field.idCustomField === this.sizeField);
      if ((currentSize?.value as Row | undefined)?.text !== card.size && (card.size || currentSize)) {
        await this.request("PUT", `/cards/${id}/customField/${this.sizeField}/item`, {}, card.size ? { value: { text: card.size } } : { value: {} });
      }
      const checklists = await this.request("GET", `/cards/${id}/checklists`, { checkItems: "all" }) as Row[];
      const currentItems = checklists.flatMap((list) => Array.isArray(list.checkItems) ? list.checkItems as Row[] : []);
      const matchesChecklist = card.checklist
        ? checklists.length === 1 && currentItems.length === card.checklist.total &&
          currentItems.filter((item) => item.state === "complete").length === card.checklist.done
        : checklists.length === 0;
      if (!matchesChecklist) for (const checklist of checklists) await this.request("DELETE", `/checklists/${idOf(checklist)}`);
      if (card.checklist && !matchesChecklist) {
        const checklist = await this.request("POST", "/checklists", { idCard: id, name: "Eval progress" }) as Row;
        for (let number = 1; number <= card.checklist.total; number++) {
          await this.request("POST", `/checklists/${idOf(checklist)}/checkItems`, {
            name: `Step ${number}`, checked: number <= card.checklist.done ? "true" : "false",
          });
        }
      }
    }
    for (const row of rows) {
      if (!cards.some((card) => row.desc === marker(card.key))) {
        await this.request("PUT", `/cards/${idOf(row)}`, { closed: "true" });
      }
    }
  }

  async verify(cards: readonly EvalCard[]): Promise<void> {
    const rows = await this.request("GET", `/boards/${this.input.boardId}/cards`, { filter: "open", fields: "name,desc,idList,idLabels,due" }) as Row[];
    if (rows.length !== cards.length) throw new Error("Eval board contains unexpected open cards");
    for (const card of cards) {
      const row = rows.find((item) => item.desc === marker(card.key));
      if (!row || row.name !== card.title || row.idList !== this.lists.get(card.list) ||
        !Array.isArray(row.idLabels) || row.idLabels.length !== 1 || row.idLabels[0] !== this.labels.get(card.project) ||
        (card.due ? Date.parse(String(row.due)) !== Date.parse(card.due) : row.due !== null)) {
        throw new Error(`Eval card postcondition failed: ${card.key}`);
      }
      const fields = await this.request("GET", `/cards/${idOf(row)}/customFieldItems`) as Row[];
      const size = fields.find((field) => field.idCustomField === this.sizeField);
      if ((size?.value as Row | undefined)?.text !== card.size) {
        throw new Error(`Eval Size postcondition failed: ${card.key}`);
      }
      if (card.checklist) {
        const lists = await this.request("GET", `/cards/${idOf(row)}/checklists`, { checkItems: "all" }) as Row[];
        const items = lists.flatMap((list) => Array.isArray(list.checkItems) ? list.checkItems as Row[] : []);
        if (items.length !== card.checklist.total || items.filter((item) => item.state === "complete").length !== card.checklist.done) {
          throw new Error(`Eval checklist postcondition failed: ${card.key}`);
        }
      }
    }
  }

  async waitingEnteredAt(key: string): Promise<string | null> {
    const id = this.cards.get(key);
    if (!id) return null;
    const actions = await this.request("GET", `/cards/${id}/actions`, { filter: "createCard,updateCard:idList", limit: "1000" }) as Row[];
    const relevant = actions.filter((action) => {
      if (action.type === "createCard") return true;
      const data = action.data as Row | undefined;
      return (data?.listAfter as Row | undefined)?.name === "Waiting";
    });
    return typeof relevant[0]?.date === "string" ? relevant[0].date : null;
  }
}
