function commitmentKey(commitment) {
    return `${commitment.label.toString()}:${commitment.hash.toString()}`;
}
function getCurrentCommitment(poolAccount) {
    return poolAccount.children.length > 0
        ? poolAccount.children[poolAccount.children.length - 1]
        : poolAccount.deposit;
}
function isRagequitEvent(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.blockNumber === "bigint" &&
        typeof candidate.transactionHash === "string");
}
function getPoolAccountsForScope(account, scope) {
    const map = account?.poolAccounts;
    if (!(map instanceof Map))
        return [];
    for (const [key, value] of map.entries()) {
        if (key.toString() === scope.toString() && Array.isArray(value)) {
            return value;
        }
    }
    return [];
}
export function poolAccountId(paNumber) {
    return `PA-${paNumber}`;
}
export function parsePoolAccountSelector(value) {
    const raw = value.trim();
    const paMatch = raw.match(/^pa-(\d+)$/i);
    const numberMatch = raw.match(/^(\d+)$/);
    const digits = paMatch?.[1] ?? numberMatch?.[1];
    if (!digits)
        return null;
    const parsed = Number.parseInt(digits, 10);
    if (!Number.isInteger(parsed) || parsed < 1)
        return null;
    return parsed;
}
export function buildPoolAccountRefs(account, scope, spendableCommitments, approvedLabels) {
    return buildAllPoolAccountRefs(account, scope, spendableCommitments, approvedLabels)
        .filter((pa) => pa.status === "spendable");
}
export function buildAllPoolAccountRefs(account, scope, spendableCommitments, approvedLabels) {
    const spendableByKey = new Map();
    for (const commitment of spendableCommitments) {
        spendableByKey.set(commitmentKey(commitment), commitment);
    }
    function resolveAspStatus(label, status) {
        if (status === "exited" || status === "spent")
            return "unknown";
        if (!approvedLabels)
            return "unknown";
        return approvedLabels.has(label.toString()) ? "approved" : "pending";
    }
    const refs = [];
    let nextPoolAccountNumber = 1;
    const poolAccounts = getPoolAccountsForScope(account, scope);
    for (const poolAccount of poolAccounts) {
        const currentCommitment = getCurrentCommitment(poolAccount);
        const key = commitmentKey(currentCommitment);
        const spendable = spendableByKey.get(key);
        const commitment = spendable ?? currentCommitment;
        const ragequit = isRagequitEvent(poolAccount.ragequit) ? poolAccount.ragequit : null;
        const status = ragequit
            ? "exited"
            : commitment.value > 0n
                ? "spendable"
                : "spent";
        refs.push({
            paNumber: nextPoolAccountNumber,
            paId: poolAccountId(nextPoolAccountNumber),
            status,
            aspStatus: resolveAspStatus(commitment.label, status),
            commitment,
            label: commitment.label,
            value: ragequit ? 0n : commitment.value,
            blockNumber: ragequit ? ragequit.blockNumber : commitment.blockNumber,
            txHash: ragequit ? ragequit.transactionHash : commitment.txHash,
        });
        if (spendable) {
            spendableByKey.delete(key);
        }
        nextPoolAccountNumber++;
    }
    // Fallback for commitments that cannot be matched to saved pool account entries.
    for (const commitment of spendableCommitments) {
        const key = commitmentKey(commitment);
        if (!spendableByKey.has(key))
            continue;
        refs.push({
            paNumber: nextPoolAccountNumber,
            paId: poolAccountId(nextPoolAccountNumber),
            status: "spendable",
            aspStatus: resolveAspStatus(commitment.label, "spendable"),
            commitment,
            label: commitment.label,
            value: commitment.value,
            blockNumber: commitment.blockNumber,
            txHash: commitment.txHash,
        });
        spendableByKey.delete(key);
        nextPoolAccountNumber++;
    }
    refs.sort((a, b) => a.paNumber - b.paNumber);
    return refs;
}
export function getNextPoolAccountNumber(account, scope) {
    return getPoolAccountsForScope(account, scope).length + 1;
}
