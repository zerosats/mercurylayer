ALTER TABLE public.statechain_data
    ADD COLUMN IF NOT EXISTS root_statechain_id varchar NULL,
    ADD COLUMN IF NOT EXISTS parent_statechain_id varchar NULL,
    ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS amount_sats bigint NULL,
    ADD COLUMN IF NOT EXISTS funding_txid varchar NULL,
    ADD COLUMN IF NOT EXISTS funding_vout integer NULL,
    ADD COLUMN IF NOT EXISTS child_index integer NULL,
    ADD COLUMN IF NOT EXISTS user_public_key bytea NULL,
    ADD COLUMN IF NOT EXISTS logical_tx_n_offset integer NOT NULL DEFAULT 0;

UPDATE public.statechain_data
SET root_statechain_id = statechain_id
WHERE root_statechain_id IS NULL;

ALTER TABLE public.statechain_data
    ALTER COLUMN root_statechain_id SET NOT NULL;

ALTER TABLE public.statechain_signature_data
    ADD COLUMN IF NOT EXISTS purpose varchar NOT NULL DEFAULT 'regular',
    ADD COLUMN IF NOT EXISTS split_id varchar NULL,
    ADD COLUMN IF NOT EXISTS logical_tx_n integer NULL;

UPDATE public.statechain_signature_data
SET logical_tx_n = tx_n
WHERE logical_tx_n IS NULL;

ALTER TABLE public.statechain_signature_data
    ALTER COLUMN logical_tx_n SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.statechain_splits (
    id serial4 NOT NULL,
    split_id varchar NOT NULL UNIQUE,
    parent_statechain_id varchar NOT NULL,
    status varchar NOT NULL DEFAULT 'pending',
    branch_fee_sats bigint NOT NULL,
    branch_tx bytea NULL,
    branch_txid varchar NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT statechain_splits_pkey PRIMARY KEY (id),
    CONSTRAINT statechain_splits_parent_fkey FOREIGN KEY (parent_statechain_id)
        REFERENCES public.statechain_data(statechain_id)
);

CREATE TABLE IF NOT EXISTS public.statechain_split_children (
    id serial4 NOT NULL,
    split_id varchar NOT NULL,
    child_statechain_id varchar NOT NULL UNIQUE,
    child_index integer NOT NULL,
    amount_sats bigint NOT NULL,
    user_public_key bytea NOT NULL,
    auth_xonly_public_key bytea NOT NULL,
    server_public_key bytea NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT statechain_split_children_pkey PRIMARY KEY (id),
    CONSTRAINT statechain_split_children_split_fkey FOREIGN KEY (split_id)
        REFERENCES public.statechain_splits(split_id)
);

CREATE INDEX IF NOT EXISTS statechain_data_root_idx
    ON public.statechain_data(root_statechain_id);

CREATE INDEX IF NOT EXISTS statechain_data_parent_idx
    ON public.statechain_data(parent_statechain_id);

CREATE INDEX IF NOT EXISTS statechain_signature_data_purpose_idx
    ON public.statechain_signature_data(statechain_id, purpose, split_id);
