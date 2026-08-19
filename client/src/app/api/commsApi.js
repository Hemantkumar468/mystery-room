import { baseApi } from './baseApi.js';
import { useCompatMutation } from './mutationCompat.js';

/**
 * Outbound communications. One endpoint today: email with attachments.
 * The server answers 503 (SMTP_NOT_CONFIGURED) until SMTP lands in .env —
 * callers surface that message and offer the mail-app fallback.
 */
export const commsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    sendEmail: build.mutation({
      // FormData, so attachments ride along; axios sets the multipart headers.
      query: (formData) => ({ url: '/comms/email', method: 'POST', data: formData }),
    }),
  }),
});

export const { useSendEmailMutation } = commsApi;

/** `useSendEmail()` — mutateAsync takes a FormData (to, cc, subject, text, attachments[]). */
export const useSendEmail = () => useCompatMutation(useSendEmailMutation);

export default commsApi;
