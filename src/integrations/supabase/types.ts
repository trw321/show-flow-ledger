export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      contract_versions: {
        Row: {
          classifications: Json
          consecutive_day_dt_multiplier: number | null
          consecutive_day_dt_threshold: number | null
          consecutive_day_grouping: string | null
          consecutive_day_ot_multiplier: number | null
          consecutive_day_ot_threshold: number | null
          consecutive_day_window_days: number | null
          contract_id: string
          created_at: string
          day_rate: number | null
          effective_date: string
          expires_date: string | null
          flat_amount: number | null
          forced_call_premium_amount: number | null
          forced_call_premium_type: string | null
          fringe_in_check: boolean | null
          fringe_percent: number | null
          hourly_rate: number | null
          id: string
          is_locked: boolean
          meal_penalty_due_after_hours: number | null
          meal_penalty_rate_type: string | null
          meal_penalty_unit: string | null
          minimum_call_hours: number | null
          night_premium_end_hour: number | null
          night_premium_multiplier: number | null
          night_premium_start_hour: number | null
          notes: string | null
          overtime_tiers: Json
          pay_delay_days: number
          pay_schedule: string
          pay_schedule_anchor_date: string | null
          rate_type: string
          rounding: string
          turnaround_minimum_hours: number | null
          turnaround_violation_multiplier: number | null
          updated_at: string
          version_label: string
        }
        Insert: {
          classifications?: Json
          consecutive_day_dt_multiplier?: number | null
          consecutive_day_dt_threshold?: number | null
          consecutive_day_grouping?: string | null
          consecutive_day_ot_multiplier?: number | null
          consecutive_day_ot_threshold?: number | null
          consecutive_day_window_days?: number | null
          contract_id: string
          created_at?: string
          day_rate?: number | null
          effective_date: string
          expires_date?: string | null
          flat_amount?: number | null
          forced_call_premium_amount?: number | null
          forced_call_premium_type?: string | null
          fringe_in_check?: boolean | null
          fringe_percent?: number | null
          hourly_rate?: number | null
          id?: string
          is_locked?: boolean
          meal_penalty_due_after_hours?: number | null
          meal_penalty_rate_type?: string | null
          meal_penalty_unit?: string | null
          minimum_call_hours?: number | null
          night_premium_end_hour?: number | null
          night_premium_multiplier?: number | null
          night_premium_start_hour?: number | null
          notes?: string | null
          overtime_tiers?: Json
          pay_delay_days?: number
          pay_schedule?: string
          pay_schedule_anchor_date?: string | null
          rate_type: string
          rounding?: string
          turnaround_minimum_hours?: number | null
          turnaround_violation_multiplier?: number | null
          updated_at?: string
          version_label: string
        }
        Update: {
          classifications?: Json
          consecutive_day_dt_multiplier?: number | null
          consecutive_day_dt_threshold?: number | null
          consecutive_day_grouping?: string | null
          consecutive_day_ot_multiplier?: number | null
          consecutive_day_ot_threshold?: number | null
          consecutive_day_window_days?: number | null
          contract_id?: string
          created_at?: string
          day_rate?: number | null
          effective_date?: string
          expires_date?: string | null
          flat_amount?: number | null
          forced_call_premium_amount?: number | null
          forced_call_premium_type?: string | null
          fringe_in_check?: boolean | null
          fringe_percent?: number | null
          hourly_rate?: number | null
          id?: string
          is_locked?: boolean
          meal_penalty_due_after_hours?: number | null
          meal_penalty_rate_type?: string | null
          meal_penalty_unit?: string | null
          minimum_call_hours?: number | null
          night_premium_end_hour?: number | null
          night_premium_multiplier?: number | null
          night_premium_start_hour?: number | null
          notes?: string | null
          overtime_tiers?: Json
          pay_delay_days?: number
          pay_schedule?: string
          pay_schedule_anchor_date?: string | null
          rate_type?: string
          rounding?: string
          turnaround_minimum_hours?: number | null
          turnaround_violation_multiplier?: number | null
          updated_at?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_versions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          contract_type: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          local_chapter: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          local_chapter?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          local_chapter?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employers: {
        Row: {
          created_at: string
          daily_doubletime_threshold_hours: number | null
          daily_overtime_threshold_hours: number | null
          default_hourly_rate: number | null
          dismissed_suggestions: Json | null
          doubletime_multiplier: number | null
          estimated_tax_percent: number | null
          id: string
          name: string
          night_premium_enabled: boolean | null
          night_premium_end_hour: number | null
          night_premium_multiplier: number | null
          night_premium_start_hour: number | null
          notes: string | null
          overtime_multiplier: number | null
          overtime_rule: string
          pay_schedule: string | null
          payroll_company: string | null
          timekeeping_app: string | null
          union_dues_percent: number | null
          union_local: string | null
          updated_at: string
          user_id: string
          vacation_percent: number | null
          weekly_overtime_threshold_hours: number | null
        }
        Insert: {
          created_at?: string
          daily_doubletime_threshold_hours?: number | null
          daily_overtime_threshold_hours?: number | null
          default_hourly_rate?: number | null
          dismissed_suggestions?: Json | null
          doubletime_multiplier?: number | null
          estimated_tax_percent?: number | null
          id?: string
          name: string
          night_premium_enabled?: boolean | null
          night_premium_end_hour?: number | null
          night_premium_multiplier?: number | null
          night_premium_start_hour?: number | null
          notes?: string | null
          overtime_multiplier?: number | null
          overtime_rule?: string
          pay_schedule?: string | null
          payroll_company?: string | null
          timekeeping_app?: string | null
          union_dues_percent?: number | null
          union_local?: string | null
          updated_at?: string
          user_id: string
          vacation_percent?: number | null
          weekly_overtime_threshold_hours?: number | null
        }
        Update: {
          created_at?: string
          daily_doubletime_threshold_hours?: number | null
          daily_overtime_threshold_hours?: number | null
          default_hourly_rate?: number | null
          dismissed_suggestions?: Json | null
          doubletime_multiplier?: number | null
          estimated_tax_percent?: number | null
          id?: string
          name?: string
          night_premium_enabled?: boolean | null
          night_premium_end_hour?: number | null
          night_premium_multiplier?: number | null
          night_premium_start_hour?: number | null
          notes?: string | null
          overtime_multiplier?: number | null
          overtime_rule?: string
          pay_schedule?: string | null
          payroll_company?: string | null
          timekeeping_app?: string | null
          union_dues_percent?: number | null
          union_local?: string | null
          updated_at?: string
          user_id?: string
          vacation_percent?: number | null
          weekly_overtime_threshold_hours?: number | null
        }
        Relationships: []
      }
      equipment: {
        Row: {
          assigned_job_id: string | null
          category: string
          created_at: string
          id: string
          name: string
          notes: string
          purchase_date: string | null
          serial_number: string | null
          status: string
          updated_at: string
          user_id: string
          value: number | null
        }
        Insert: {
          assigned_job_id?: string | null
          category?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          purchase_date?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
          user_id: string
          value?: number | null
        }
        Update: {
          assigned_job_id?: string | null
          category?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          purchase_date?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assigned_job_id_fkey"
            columns: ["assigned_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          location: string | null
          notes: string | null
          start_time: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          description: string
          id: string
          job_id: string | null
          receipt: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          date: string
          description?: string
          id?: string
          job_id?: string | null
          receipt?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
          job_id?: string | null
          receipt?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      gigs: {
        Row: {
          break_minutes: number
          contract_snapshot: Json | null
          contract_version_id: string | null
          created_at: string
          dress_code: string | null
          employer_party_id: string | null
          end_time: string | null
          expected_pay: number | null
          expected_pay_date: string | null
          forced_call: boolean
          hiring_party_id: string | null
          id: string
          is_head: boolean
          is_split: boolean
          job_number: string | null
          job_site: string | null
          line_notes: string | null
          local: string | null
          meal_breaks: Json
          meal_penalty_hours: number
          meals_on_clock: boolean
          minimum_hours: number | null
          notes: string | null
          offered_day_rate: number | null
          offered_flat_amount: number | null
          offered_hourly_rate: number | null
          payor_party_id: string | null
          position_name: string | null
          report_to: string | null
          show_name: string | null
          split_related_gig_id: string | null
          start_time: string | null
          status: string
          steward_name: string | null
          updated_at: string
          user_id: string
          venue: string | null
          work_date: string
          worked_hours: number | null
        }
        Insert: {
          break_minutes?: number
          contract_snapshot?: Json | null
          contract_version_id?: string | null
          created_at?: string
          dress_code?: string | null
          employer_party_id?: string | null
          end_time?: string | null
          expected_pay?: number | null
          expected_pay_date?: string | null
          forced_call?: boolean
          hiring_party_id?: string | null
          id?: string
          is_head?: boolean
          is_split?: boolean
          job_number?: string | null
          job_site?: string | null
          line_notes?: string | null
          local?: string | null
          meal_breaks?: Json
          meal_penalty_hours?: number
          meals_on_clock?: boolean
          minimum_hours?: number | null
          notes?: string | null
          offered_day_rate?: number | null
          offered_flat_amount?: number | null
          offered_hourly_rate?: number | null
          payor_party_id?: string | null
          position_name?: string | null
          report_to?: string | null
          show_name?: string | null
          split_related_gig_id?: string | null
          start_time?: string | null
          status?: string
          steward_name?: string | null
          updated_at?: string
          user_id: string
          venue?: string | null
          work_date: string
          worked_hours?: number | null
        }
        Update: {
          break_minutes?: number
          contract_snapshot?: Json | null
          contract_version_id?: string | null
          created_at?: string
          dress_code?: string | null
          employer_party_id?: string | null
          end_time?: string | null
          expected_pay?: number | null
          expected_pay_date?: string | null
          forced_call?: boolean
          hiring_party_id?: string | null
          id?: string
          is_head?: boolean
          is_split?: boolean
          job_number?: string | null
          job_site?: string | null
          line_notes?: string | null
          local?: string | null
          meal_breaks?: Json
          meal_penalty_hours?: number
          meals_on_clock?: boolean
          minimum_hours?: number | null
          notes?: string | null
          offered_day_rate?: number | null
          offered_flat_amount?: number | null
          offered_hourly_rate?: number | null
          payor_party_id?: string | null
          position_name?: string | null
          report_to?: string | null
          show_name?: string | null
          split_related_gig_id?: string | null
          start_time?: string | null
          status?: string
          steward_name?: string | null
          updated_at?: string
          user_id?: string
          venue?: string | null
          work_date?: string
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gigs_contract_version_id_fkey"
            columns: ["contract_version_id"]
            isOneToOne: false
            referencedRelation: "contract_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gigs_employer_party_id_fkey"
            columns: ["employer_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gigs_hiring_party_id_fkey"
            columns: ["hiring_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gigs_payor_party_id_fkey"
            columns: ["payor_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gigs_split_related_gig_id_fkey"
            columns: ["split_related_gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
        ]
      }
      income: {
        Row: {
          amount: number
          client: string
          created_at: string
          date: string
          description: string
          id: string
          invoice_number: string | null
          job_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          client?: string
          created_at?: string
          date: string
          description?: string
          id?: string
          invoice_number?: string | null
          job_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          client?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
          invoice_number?: string | null
          job_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attachments: string[] | null
          call_gaps_on_clock: Json | null
          call_timeline: string | null
          client: string
          created_at: string
          date: string
          end_time: string | null
          has_6th_7th_day_rule: boolean
          has_vacation_pay: boolean
          hourly_rate: number | null
          hours_worked: number | null
          id: string
          job_number: string | null
          local: string | null
          meal_duration: number | null
          meal_on_clock: boolean | null
          meal_penalties: number
          meal_type: string | null
          meal2_duration: number | null
          meal2_on_clock: boolean | null
          minimum_hours: number | null
          name: string
          needs_review: boolean | null
          night_premium_actual_hours: number | null
          night_premium_confirmed: boolean | null
          notes: string
          parking_cost: number | null
          pay_period_start: string | null
          pay_schedule: string | null
          pay_stub: string | null
          payroll_company: string | null
          start_time: string | null
          status: string
          steward: string | null
          stub_corrections: Json | null
          stub_parsed: Json | null
          updated_at: string
          user_id: string
          venue: string
        }
        Insert: {
          attachments?: string[] | null
          call_gaps_on_clock?: Json | null
          call_timeline?: string | null
          client?: string
          created_at?: string
          date: string
          end_time?: string | null
          has_6th_7th_day_rule?: boolean
          has_vacation_pay?: boolean
          hourly_rate?: number | null
          hours_worked?: number | null
          id?: string
          job_number?: string | null
          local?: string | null
          meal_duration?: number | null
          meal_on_clock?: boolean | null
          meal_penalties?: number
          meal_type?: string | null
          meal2_duration?: number | null
          meal2_on_clock?: boolean | null
          minimum_hours?: number | null
          name: string
          needs_review?: boolean | null
          night_premium_actual_hours?: number | null
          night_premium_confirmed?: boolean | null
          notes?: string
          parking_cost?: number | null
          pay_period_start?: string | null
          pay_schedule?: string | null
          pay_stub?: string | null
          payroll_company?: string | null
          start_time?: string | null
          status?: string
          steward?: string | null
          stub_corrections?: Json | null
          stub_parsed?: Json | null
          updated_at?: string
          user_id: string
          venue?: string
        }
        Update: {
          attachments?: string[] | null
          call_gaps_on_clock?: Json | null
          call_timeline?: string | null
          client?: string
          created_at?: string
          date?: string
          end_time?: string | null
          has_6th_7th_day_rule?: boolean
          has_vacation_pay?: boolean
          hourly_rate?: number | null
          hours_worked?: number | null
          id?: string
          job_number?: string | null
          local?: string | null
          meal_duration?: number | null
          meal_on_clock?: boolean | null
          meal_penalties?: number
          meal_type?: string | null
          meal2_duration?: number | null
          meal2_on_clock?: boolean | null
          minimum_hours?: number | null
          name?: string
          needs_review?: boolean | null
          night_premium_actual_hours?: number | null
          night_premium_confirmed?: boolean | null
          notes?: string
          parking_cost?: number | null
          pay_period_start?: string | null
          pay_schedule?: string | null
          pay_stub?: string | null
          payroll_company?: string | null
          start_time?: string | null
          status?: string
          steward?: string | null
          stub_corrections?: Json | null
          stub_parsed?: Json | null
          updated_at?: string
          user_id?: string
          venue?: string
        }
        Relationships: []
      }
      match_suggestions: {
        Row: {
          candidate_matches: Json
          id: string
          payment_id: string
          resolved_at: string | null
          status: string
          suggested_at: string
          user_choice: Json | null
          user_id: string
        }
        Insert: {
          candidate_matches?: Json
          id?: string
          payment_id: string
          resolved_at?: string | null
          status?: string
          suggested_at?: string
          user_choice?: Json | null
          user_id: string
        }
        Update: {
          candidate_matches?: Json
          id?: string
          payment_id?: string
          resolved_at?: string | null
          status?: string
          suggested_at?: string
          user_choice?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_suggestions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          badge_color: string | null
          contact_name: string | null
          created_at: string
          default_contract_id: string | null
          email: string | null
          estimated_withholding_rate: number | null
          id: string
          is_active: boolean
          local_chapter: string | null
          name: string
          notes: string | null
          payor_aliases: string[]
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          badge_color?: string | null
          contact_name?: string | null
          created_at?: string
          default_contract_id?: string | null
          email?: string | null
          estimated_withholding_rate?: number | null
          id?: string
          is_active?: boolean
          local_chapter?: string | null
          name: string
          notes?: string | null
          payor_aliases?: string[]
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          badge_color?: string | null
          contact_name?: string | null
          created_at?: string
          default_contract_id?: string | null
          email?: string | null
          estimated_withholding_rate?: number | null
          id?: string
          is_active?: boolean
          local_chapter?: string | null
          name?: string
          notes?: string | null
          payor_aliases?: string[]
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parties_default_contract_id_fkey"
            columns: ["default_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_allocations: {
        Row: {
          allocation_type: string
          amount_allocated: number
          created_at: string
          gig_id: string
          id: string
          notes: string | null
          payment_id: string
        }
        Insert: {
          allocation_type?: string
          amount_allocated: number
          created_at?: string
          gig_id: string
          id?: string
          notes?: string | null
          payment_id: string
        }
        Update: {
          allocation_type?: string
          amount_allocated?: number
          created_at?: string
          gig_id?: string
          id?: string
          notes?: string | null
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_gig_id_fkey"
            columns: ["gig_id"]
            isOneToOne: false
            referencedRelation: "gigs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_received: number
          created_at: string
          data_completeness: string
          federal_withheld: number | null
          fica_withheld: number | null
          gross_amount: number | null
          id: string
          input_mode: string
          local_withheld: number | null
          match_confidence: string | null
          medicare_withheld: number | null
          notes: string | null
          other_deductions: number | null
          other_deductions_notes: string | null
          payment_method: string | null
          payor_party_id: string | null
          payor_raw_string: string | null
          received_date: string
          reference: string | null
          state_withheld: number | null
          user_id: string
        }
        Insert: {
          amount_received: number
          created_at?: string
          data_completeness?: string
          federal_withheld?: number | null
          fica_withheld?: number | null
          gross_amount?: number | null
          id?: string
          input_mode?: string
          local_withheld?: number | null
          match_confidence?: string | null
          medicare_withheld?: number | null
          notes?: string | null
          other_deductions?: number | null
          other_deductions_notes?: string | null
          payment_method?: string | null
          payor_party_id?: string | null
          payor_raw_string?: string | null
          received_date: string
          reference?: string | null
          state_withheld?: number | null
          user_id: string
        }
        Update: {
          amount_received?: number
          created_at?: string
          data_completeness?: string
          federal_withheld?: number | null
          fica_withheld?: number | null
          gross_amount?: number | null
          id?: string
          input_mode?: string
          local_withheld?: number | null
          match_confidence?: string | null
          medicare_withheld?: number | null
          notes?: string | null
          other_deductions?: number | null
          other_deductions_notes?: string | null
          payment_method?: string | null
          payor_party_id?: string | null
          payor_raw_string?: string | null
          received_date?: string
          reference?: string | null
          state_withheld?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_payor_party_id_fkey"
            columns: ["payor_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
