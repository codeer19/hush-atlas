import { apiOrigin, isRemoteApi } from "../api";

export function isServerProcessing(): boolean {
  return isRemoteApi();
}

export function RemoteProcessingNotice({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!isRemoteApi()) {
    return null;
  }
  const host = apiOrigin()?.replace(/^https?:\/\//, "") ?? "the Hush Atlas server";
  return (
    <label className="check-field field--wide remote-notice">
      <input
        type="checkbox"
        checked={accepted}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>This deployment analyses audio on the server</strong>
        <small>
          Your recording is uploaded over HTTPS to {host} for the YAMNet sound
          search and stored there. On-device AI runs in this browser, but it
          does not analyse audio.
        </small>
      </span>
    </label>
  );
}
