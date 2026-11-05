CREATE TABLE "player_tutorial_progress" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"stage" smallint DEFAULT 0 NOT NULL,
	"stage1_completed_at" timestamp with time zone,
	"stage2_completed_at" timestamp with time zone,
	"stage3_completed_at" timestamp with time zone,
	"grandfathered_at" timestamp with time zone,
	"graduated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_tutorial_progress_stage_check" CHECK ("player_tutorial_progress"."stage" between 0 and 3),
	CONSTRAINT "player_tutorial_progress_stage1_check" CHECK (("player_tutorial_progress"."stage1_completed_at" is null) = ("player_tutorial_progress"."stage" < 1)),
	CONSTRAINT "player_tutorial_progress_stage2_check" CHECK (("player_tutorial_progress"."stage2_completed_at" is null) = ("player_tutorial_progress"."stage" < 2)),
	CONSTRAINT "player_tutorial_progress_stage3_check" CHECK (("player_tutorial_progress"."stage3_completed_at" is null) = ("player_tutorial_progress"."stage" < 3)),
	CONSTRAINT "player_tutorial_progress_graduation_check" CHECK (("player_tutorial_progress"."graduated_at" is null) = ("player_tutorial_progress"."stage" < 3))
);
--> statement-breakpoint
CREATE TABLE "tutorial_release" (
	"id" smallint PRIMARY KEY NOT NULL,
	"enforced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grandfather_before" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutorial_release_singleton_check" CHECK ("tutorial_release"."id" = 1),
	CONSTRAINT "tutorial_release_window_check" CHECK ("tutorial_release"."grandfather_before" <= "tutorial_release"."enforced_at")
);
--> statement-breakpoint
ALTER TABLE "player_tutorial_progress" ADD CONSTRAINT "player_tutorial_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;