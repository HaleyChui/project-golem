const ResponseParser = require('../../../src/utils/ResponseParser');

function stripEnvelope(text) {
    return String(text || '')
        .replace(/\[\[BEGIN:[^\]]+\]\]/gi, '')
        .replace(/\[\[END:[^\]]+\]\]/gi, '')
        .trim();
}

function extractTagContent(text, tagName) {
    const pattern = new RegExp(`\\[${tagName}\\]([\\s\\S]*?)(?=\\[GOLEM_[A-Z]+\\]|$)`, 'i');
    const match = String(text || '').match(pattern);
    return match && match[1] ? stripEnvelope(match[1]) : '';
}

function unwrapCodeFence(text) {
    const cleaned = String(text || '').trim();
    const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    return (match && match[1] ? match[1] : cleaned).trim();
}

function startsLikeJson(text) {
    const cleaned = unwrapCodeFence(text);
    return cleaned.startsWith('{') || cleaned.startsWith('[');
}

function normalizeRpgOutput(rawText) {
    const cleaned = stripEnvelope(rawText);
    if (!/\[GOLEM_(?:MEMORY|ACTION|REPLY)\]/i.test(cleaned)) {
        return startsLikeJson(cleaned) ? unwrapCodeFence(cleaned) : cleaned;
    }

    const parsed = ResponseParser.parse(cleaned);
    const reply = stripEnvelope(parsed.reply || '');
    if (startsLikeJson(reply)) return unwrapCodeFence(reply);

    const action = extractTagContent(cleaned, 'GOLEM_ACTION');
    if (startsLikeJson(action)) return unwrapCodeFence(action);

    return reply || cleaned
        .replace(/\[GOLEM_MEMORY\][\s\S]*?(?=\[GOLEM_ACTION\]|\[GOLEM_REPLY\]|$)/gi, '')
        .replace(/\[GOLEM_ACTION\][\s\S]*?(?=\[GOLEM_REPLY\]|$)/gi, '')
        .replace(/\[GOLEM_REPLY\]/gi, '')
        .trim();
}

module.exports = {
    normalizeRpgOutput,
    stripEnvelope,
    extractTagContent,
};
