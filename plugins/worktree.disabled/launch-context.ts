export function buildSessionLaunchArgv(sessionID: string): string[] {
	const trimmed = sessionID?.trim()
	if (!trimmed) {
		throw new Error("Session id is required to build launch argv")
	}

	return ["opencode", "--session", trimmed]
}
