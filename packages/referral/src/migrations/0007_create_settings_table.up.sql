begin;

    -- CreateTable
    CREATE TABLE if not exists "referral_settings" (
        "property" VARCHAR(50) NOT NULL,
        "value" VARCHAR(50) NOT NULL,

        CONSTRAINT "referral_settings_pkey" PRIMARY KEY ("property")
    );

end;